import {
  Bot,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.15.3/mod.ts";
import {
  viewEngine,
  oakAdapter,
  handlebarsEngine,
} from "https://deno.land/x/view_engine@v10.6.0/mod.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { Router, Application } from "https://deno.land/x/oak@v12.1.0/mod.ts";

import logger from "https://deno.land/x/oak_logger@1.0.0/mod.ts";

const env = config();

const BOT_TOKEN = env["BOT_TOKEN"];
const BOT_TOKEN_UINT8ARRAY = new TextEncoder().encode(BOT_TOKEN);
const DB_URL = env["DB_URL"];
const DOMAIN = env["DOMAIN"];
const BOT_USERNAME = env["BOT_USERNAME"];

let key: CryptoKey | null = null;
async function getHashKey() {
  if (key) return key;

  const secret_key = new Uint8Array(
    await crypto.subtle.digest("SHA-256", BOT_TOKEN_UINT8ARRAY)
  );

  key = await crypto.subtle.importKey(
    "raw",
    secret_key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return key;
}

function dataToUint8Array(data: Record<string, unknown>) {
  const stringifiedData = Object.keys(data)
    .sort()
    .filter((k) => data[k])
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  return new TextEncoder().encode(stringifiedData);
}

async function checkSignature(data: Record<string, unknown>) {
  const key = await getHashKey();
  const uint8ArrayData = dataToUint8Array(data);

  const dataHMACHash = new Uint8Array(
    await crypto.subtle.sign({ name: "HMAC" }, key, uint8ArrayData)
  );

  const verified = await crypto.subtle.verify(
    { name: "HMAC" },
    key,
    dataHMACHash,
    uint8ArrayData
  );

  return verified;
}

const client = new Client(DB_URL);
await client.connect();
console.log("Connected to database");

const app = new Application();

app.use(logger.logger);
app.use(logger.responseTime);

const bot = new Bot(BOT_TOKEN);
console.log("Bot created");

app.use((ctx, next) => {
  if (ctx.request.url.pathname === "/bot") {
    return webhookCallback(bot, "oak");
  } else {
    return next();
  }
});

app.use(
  viewEngine(oakAdapter, handlebarsEngine, {
    viewRoot: "./src/views",
  })
);

const router = new Router();

const toInt = (str: string | null) => {
  if (str === null) return null;
  return parseInt(str);
};

router.get("/", (ctx) => {
  // @ts-ignore: render method is not defined in oak
  ctx.render("index.hbs", {
    domain: DOMAIN,
    bot_username: BOT_USERNAME,
  });
});

router.get("/callback", async (ctx) => {
  const id = toInt(ctx.request.url.searchParams.get("id"));
  const username = ctx.request.url.searchParams.get("username");
  const auth_date = toInt(ctx.request.url.searchParams.get("auth_date"));
  const hash = ctx.request.url.searchParams.get("hash");

  if (!id || !username || !auth_date || !hash) {
    ctx.response.body = "Something went wrong";
    return;
  }

  const first_name = ctx.request.url.searchParams.get("first_name")!;
  const last_name = ctx.request.url.searchParams.get("last_name")!;
  const photo_url = ctx.request.url.searchParams.get("photo_url")!;

  const verified = await checkSignature({
    id,
    username,
    auth_date,
    first_name,
    last_name,
    photo_url,
  });

  if (!verified) {
    ctx.response.body = "Something went wrong";
    return;
  }

  const result = await client.queryObject`SELECT * FROM users WHERE id = ${id}`;

  if (result.rows.length === 0) {
    await client.queryObject`
      INSERT INTO users 
        (id, username, first_name, last_name, photo_url, auth_date)
        VALUES (${id}, ${username}, ${first_name}, ${last_name}, ${photo_url}, ${auth_date})
    `;

    await bot.api.sendMessage(id, "Welcome to the bot!");
  } else {
    await bot.api.sendMessage(id, "Welcome back!");
  }

  ctx.cookies.set("id", id.toString(), {
    httpOnly: true,
    expires: new Date(Date.now() + 86400000), // 1 day
  });

  ctx.response.redirect("/profile");
});

router.get("/profile", async (ctx) => {
  const id = toInt((await ctx.cookies.get("id")) || null);

  if (!id) {
    ctx.response.redirect("/");
    return;
  }

  const result = await client.queryObject`SELECT * FROM users WHERE id = ${id}`;

  if (result.rows.length === 0) {
    ctx.response.redirect("/");
    return;
  }

  const user = result.rows[0];

  // @ts-ignore: render method is not defined in oak
  ctx.render("profile.hbs", { ...user });
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log("Server started");
await app.listen({ port: 8080 });
