import sanitizeHtml from "sanitize-html";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db.js";
import { isMailConfigured, sendNewPassword, sendVerification } from "./mail.js";

class MySQLSessionStore extends session.Store {
  get(sid, cb) {
    pool
      .query(
        "SELECT data FROM sessions WHERE session_id=? AND expires_at>NOW()",
        [sid],
      )
      .then(([[r]]) =>
        cb(
          null,
          r ? (typeof r.data === "string" ? JSON.parse(r.data) : r.data) : null,
        ),
      )
      .catch(cb);
  }
  set(sid, data, cb = () => {}) {
    const expires = new Date(data.cookie?.expires || Date.now() + 2592000000);
    pool
      .execute(
        "INSERT INTO sessions(session_id,data,expires_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)",
        [sid, JSON.stringify(data), expires],
      )
      .then(() => cb())
      .catch(cb);
  }
  destroy(sid, cb = () => {}) {
    pool
      .execute("DELETE FROM sessions WHERE session_id=?", [sid])
      .then(() => cb())
      .catch(cb);
  }
  touch(sid, data, cb = () => {}) {
    this.set(sid, data, cb);
  }
}
const app = express(),
  port = Number(process.env.PORT || 3001);
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
)
  throw new Error("生产环境 SESSION_SECRET 必须至少为 32 个字符");
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      directives: { "upgrade-insecure-requests": null },
    },
  }),
);
app.use(
  cors({
    origin: process.env.WEB_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  const configuredOrigin = process.env.WEB_ORIGIN || "http://localhost:5173";
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const currentOrigin = `${req.protocol}://${forwardedHost || req.get("host")}`;
  if (origin && origin !== configuredOrigin && origin !== currentOrigin)
    return res.status(403).json({ message: "请求来源无效" });
  next();
});
app.use(cookieParser());
app.use(
  "/audio/words",
  express.static(
    process.env.AUDIO_WORDS_DIR || path.resolve("shared/audio/words"),
    { fallthrough: true, maxAge: "7d", immutable: false },
  ),
);
app.use(
  session({
    name: "wordhop.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-me",
    store: new MySQLSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);
const authLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime = req.rateLimit?.resetTime?.getTime?.() || Date.now() + 300000;
    const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
    res.status(429).json({
      message: `操作过于频繁，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试`,
      retryAfter,
    });
  },
});
const guestReadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(100),
  name: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/)
    .optional(),
  email: z.string().trim().email().max(255).optional(),
});
const requireUser = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ message: "请先登录" });
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ message: "请先登录" });
  const [[u]] = await pool.query("SELECT role,status FROM users WHERE id=?", [
    req.session.userId,
  ]);
  return u?.role === "ADMIN" && u.status === "ACTIVE"
    ? next()
    : res.status(403).json({ message: "无管理员权限" });
};
async function logEvent(req, eventType, metadata = {}) {
  const ip = String(req.ip || ""),
    ipHash = ip
      ? crypto
          .createHash("sha256")
          .update(ip + (process.env.SESSION_SECRET || "salt"))
          .digest("hex")
      : null;
  await pool.execute(
    "INSERT INTO user_events(user_id,session_id,event_type,path,metadata,ip_hash,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?)",
    [
      req.session.userId || null,
      req.sessionID || null,
      eventType,
      req.path,
      JSON.stringify(metadata),
      ipHash,
      ip.slice(0, 45),
      String(req.get("user-agent") || "").slice(0, 500),
    ],
  );
}
async function emailCooldown(email, purpose) {
  const [[recent]] = await pool.query(
    "SELECT 300-TIMESTAMPDIFF(SECOND,sent_at,NOW()) AS retryAfter FROM email_send_logs WHERE email=? AND purpose=? AND sent_at>DATE_SUB(NOW(),INTERVAL 5 MINUTE) ORDER BY id DESC LIMIT 1",
    [email, purpose],
  );
  return recent ? Math.max(1, Number(recent.retryAfter)) : 0;
}
async function recordEmail(email, purpose) {
  await pool.execute(
    "INSERT INTO email_send_logs(email,purpose) VALUES(?,?)",
    [email, purpose],
  );
}
async function ensureUserLibrary(userId) {
  await pool.execute(
    'INSERT INTO word_libraries(code,name,library_type,owner_user_id) VALUES(?,"用户库","USER",?) ON DUPLICATE KEY UPDATE name="用户库"',
    [`USER-${userId}`, userId],
  );
  const [[row]] = await pool.query(
    "SELECT id FROM word_libraries WHERE owner_user_id=?",
    [userId],
  );
  return row.id;
}
async function allowedLibrary(userId, libraryId) {
  const [[row]] = await pool.query(
    'SELECT id,code,name,library_type AS libraryType,owner_user_id AS ownerUserId FROM word_libraries WHERE id=? AND (library_type="SYSTEM" OR owner_user_id=?)',
    [libraryId, userId],
  );
  return row;
}
const tokenHash = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const randomPassword = () =>
  `${crypto.randomBytes(6).toString("base64url")}aA8!`;
const audioDirectory =
  process.env.AUDIO_WORDS_DIR || path.resolve("shared/audio/words");
const audioLocks = new Map();
function audioFilename(word) {
  return `${word.trim().toLowerCase().replace(/\s+/g, " ")}.mp3`;
}
function looksLikeMp3(buffer) {
  return (
    buffer.length >= 500 &&
    (buffer.subarray(0, 3).toString("ascii") === "ID3" ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
  );
}
async function ensureWordAudio(word) {
  const filename = audioFilename(word),
    filePath = path.join(audioDirectory, filename),
    audioUrl = `/audio/words/${encodeURIComponent(filename)}`;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size >= 500 && looksLikeMp3(await fs.readFile(filePath))) return { audioUrl, downloaded: false };
  } catch {}
  if (audioLocks.has(filename)) return audioLocks.get(filename);
  const task = (async () => {
    await fs.mkdir(audioDirectory, { recursive: true });
    const sources = [
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
      `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(word)}&spd=3&source=web`,
    ];
    for (const source of sources) {
      try {
        const response = await fetch(source, {
          redirect: "follow",
          headers: {
            accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
            "user-agent": "Mozilla/5.0 WordHop/1.0",
          },
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!looksLikeMp3(buffer)) continue;
        const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temporary, buffer, { flag: "wx" });
        try {
          await fs.rename(temporary, filePath);
        } catch (error) {
          await fs.rm(temporary, { force: true });
          if (error.code !== "EEXIST") throw error;
        }
        return { audioUrl, downloaded: true };
      } catch (error) {
        console.warn(`下载单词音频失败 ${word}:`, error.message);
      }
    }
    return { audioUrl: null, downloaded: false };
  })().finally(() => audioLocks.delete(filename));
  audioLocks.set(filename, task);
  return task;
}
async function lookupExample(word) {
  const response = await fetch(
    `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`,
    {
      headers: { "user-agent": "Mozilla/5.0 WordHop/1.0" },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) return null;
  const data = await response.json();
  const pairs = data.blng_sents_part?.["sentence-pair"] || [];
  const pair = pairs.find(
    (item) => item.sentence && item["sentence-translation"],
  );
  return pair
    ? { exampleEn: pair.sentence, exampleCn: pair["sentence-translation"] }
    : null;
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database_unavailable" });
  }
});
app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const [[user]] = await pool.query(
    'SELECT id,username,name,phone,email,role,status,score,study_seconds AS studySeconds,redeemed_pets AS redeemedPets,last_library_id AS lastLibraryId FROM users WHERE id=? AND status="ACTIVE"',
    [req.session.userId],
  );
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user });
});
app.post("/api/auth/register", authLimit, async (req, res) => {
  const p = credentials.safeParse(req.body);
  if (!p.success || !p.data.name || !p.data.phone || !p.data.email)
    return res
      .status(400)
      .json({ message: "登录名、姓名、手机号、邮箱或密码格式不正确" });
  if (!isMailConfigured())
    return res.status(503).json({ message: "邮件服务尚未配置，暂时无法注册" });
  const { username, password, name, phone, email } = p.data,
    connection = await pool.getConnection();
  const normalizedEmail = email.toLowerCase();
  const retryAfter = await emailCooldown(normalizedEmail, "VERIFY");
  if (retryAfter)
    return res.status(429).json({
      message: `验证邮件发送过于频繁，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试`,
      retryAfter,
    });
  try {
    await connection.beginTransaction();
    const hash = await bcrypt.hash(password, 12);
    const [result] = await connection.execute(
      'INSERT INTO users(username,name,phone,email,password_hash,status) VALUES(?,?,?,?,?,"PENDING")',
      [username, name, phone, normalizedEmail, hash],
    );
    await connection.execute(
      'INSERT INTO word_libraries(code,name,library_type,owner_user_id) VALUES(?,"用户库","USER",?)',
      [`USER-${result.insertId}`, result.insertId],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await connection.execute(
      'INSERT INTO account_tokens(user_id,token_hash,token_type,expires_at) VALUES(?,?,"EMAIL_VERIFY",DATE_ADD(NOW(),INTERVAL 24 HOUR))',
      [result.insertId, tokenHash(token)],
    );
    await sendVerification(email, name, token);
    await connection.execute(
      'INSERT INTO email_send_logs(email,purpose) VALUES(?,"VERIFY")',
      [normalizedEmail],
    );
    await connection.commit();
    await logEvent(req, "REGISTER", { userId: result.insertId, username });
    res
      .status(201)
      .json({ message: "验证邮件已发送，完成邮箱验证后即可登录" });
  } catch (e) {
    await connection.rollback();
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "登录名或邮箱已存在" });
    throw e;
  } finally {
    connection.release();
  }
});
app.get("/api/auth/verify-email", authLimit, async (req, res) => {
  const token = String(req.query.token || "");
  if (!/^[a-f0-9]{64}$/.test(token))
    return res.status(400).json({ message: "验证链接无效" });
  const [[row]] = await pool.query(
    'SELECT id,user_id AS userId FROM account_tokens WHERE token_hash=? AND token_type="EMAIL_VERIFY" AND used_at IS NULL AND expires_at>NOW()',
    [tokenHash(token)],
  );
  if (!row) return res.status(400).json({ message: "验证链接无效或已过期" });
  await pool.execute('UPDATE users SET email_verified_at=NOW(),status="ACTIVE",approved_at=NOW() WHERE id=?', [
    row.userId,
  ]);
  await pool.execute("UPDATE account_tokens SET used_at=NOW() WHERE id=?", [
    row.id,
  ]);
  res.json({ message: "邮箱验证成功，现在可以登录使用了" });
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const p = z.object({ username: z.string().trim().min(3).max(255), password: z.string().min(8).max(100) }).safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ message: "登录名或密码格式不正确" });
  const identifier = p.data.username.toLowerCase();
  const [[user]] = await pool.query(
    "SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=? LIMIT 1",
    [identifier, identifier],
  );
  if (!user || !(await bcrypt.compare(p.data.password, user.password_hash))) {
    await logEvent(req, "LOGIN_FAILED", { username: p.data.username });
    return res.status(401).json({ message: "登录名、邮箱或密码错误" });
  }
  if (!user.email_verified_at)
    return res.status(403).json({ message: "请先完成邮箱验证" });
  if (user.status === "PENDING")
    return res.status(403).json({ message: "请先完成邮箱验证" });
  if (user.status === "DISABLED")
    return res.status(403).json({ message: "账户已被禁用，请联系管理员" });
  await new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.userId = user.id;
  const userLibraryId = await ensureUserLibrary(user.id);
  if (!user.last_library_id) {
    const [[ielts]] = await pool.query(
      'SELECT id FROM word_libraries WHERE code="IELTS"',
    );
    user.last_library_id = ielts?.id || userLibraryId;
    await pool.execute("UPDATE users SET last_library_id=? WHERE id=?", [
      user.last_library_id,
      user.id,
    ]);
  }
  await pool.execute("UPDATE users SET last_login_at=NOW() WHERE id=?", [
    user.id,
  ]);
  await logEvent(req, "LOGIN_SUCCESS");
  res.json({
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      status: user.status,
      lastLibraryId: user.last_library_id,
    },
  });
});
app.post("/api/auth/logout", requireUser, async (req, res) => {
  await logEvent(req, "LOGOUT");
  req.session.destroy(() => {
    res.clearCookie("wordhop.sid");
    res.status(204).end();
  });
});
app.post("/api/auth/change-password", requireUser, async (req, res) => {
  const p = z
    .object({
      oldPassword: z.string().min(8).max(100),
      newPassword: z.string().min(8).max(100),
      confirmPassword: z.string(),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: "两次新密码不一致",
    })
    .safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ message: p.error.issues[0]?.message || "密码格式不正确" });
  const [[user]] = await pool.query(
    "SELECT password_hash FROM users WHERE id=?",
    [req.session.userId],
  );
  if (!(await bcrypt.compare(p.data.oldPassword, user.password_hash)))
    return res.status(400).json({ message: "原密码错误" });
  if (await bcrypt.compare(p.data.newPassword, user.password_hash))
    return res.status(400).json({ message: "新密码不能与原密码相同" });
  await pool.execute("UPDATE users SET password_hash=? WHERE id=?", [
    await bcrypt.hash(p.data.newPassword, 12),
    req.session.userId,
  ]);
  await logEvent(req, "PASSWORD_CHANGED");
  req.session.destroy(() => {
    res.clearCookie("wordhop.sid");
    res.json({ message: "密码修改成功，请重新登录" });
  });
});
app.post("/api/auth/forgot-password", authLimit, async (req, res) => {
  const p = z
    .object({ email: z.string().email().max(255) })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: "邮箱格式不正确" });
  const email = p.data.email.toLowerCase();
  const retryAfter = await emailCooldown(email, "PASSWORD_RESET");
  if (retryAfter)
    return res.status(429).json({
      message: `重置邮件发送过于频繁，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试`,
      retryAfter,
    });
  const [[user]] = await pool.query(
    'SELECT id,name,email FROM users WHERE email=? AND email_verified_at IS NOT NULL AND status="ACTIVE"',
    [email],
  );
  if (user) {
    const password = randomPassword();
    await sendNewPassword(user.email, user.name, password, "找回密码");
    await recordEmail(email, "PASSWORD_RESET");
    await pool.execute("UPDATE users SET password_hash=? WHERE id=?", [
      await bcrypt.hash(password, 12),
      user.id,
    ]);
    await logEvent(req, "PASSWORD_RECOVERED", { userId: user.id });
  }
  res.json({ message: "如果该邮箱属于正常账户，新密码将发送到邮箱" });
});

app.get("/api/libraries", requireUser, async (req, res) => {
  await ensureUserLibrary(req.session.userId);
  const [rows] = await pool.query(
    'SELECT l.id,l.code,l.name,l.library_type AS libraryType,(SELECT COUNT(*) FROM words w WHERE w.library_id=l.id) AS wordCount FROM word_libraries l WHERE l.library_type="SYSTEM" OR l.owner_user_id=? ORDER BY (l.library_type="USER"),FIELD(l.code,"PRIMARY","JUNIOR","SENIOR","POSTGRAD","IELTS","CET4","CET6")',
    [req.session.userId],
  );
  const [[u]] = await pool.query(
    "SELECT last_library_id AS selectedLibraryId FROM users WHERE id=?",
    [req.session.userId],
  );
  res.json({
    libraries: rows,
    selectedLibraryId: u.selectedLibraryId || rows[0]?.id,
  });
});
app.post("/api/libraries/select", requireUser, async (req, res) => {
  const p = z
    .object({ libraryId: z.number().int().positive() })
    .safeParse(req.body);
  if (
    !p.success ||
    !(await allowedLibrary(req.session.userId, p.data.libraryId))
  )
    return res.status(404).json({ message: "词库不存在" });
  await pool.execute("UPDATE users SET last_library_id=? WHERE id=?", [
    p.data.libraryId,
    req.session.userId,
  ]);
  await logEvent(req, "SELECT_LIBRARY", { libraryId: p.data.libraryId });
  res.json({ ok: true });
});
app.get("/api/words", requireUser, async (req, res) => {
  const libraryId = Number(req.query.libraryId);
  if (!libraryId || !(await allowedLibrary(req.session.userId, libraryId)))
    return res.status(404).json({ message: "词库不存在" });
  const [rows] = await pool.query(
    "SELECT id,word,phonetic,meaning,example_en AS exampleEn,example_cn AS exampleCn,source,audio_url AS audioUrl FROM words WHERE library_id=? ORDER BY id",
    [libraryId],
  );
  res.json(rows);
});
app.get("/api/words/:id/example", requireUser, async (req, res) => {
  return serveWordExample(req, res, false);
});
async function serveWordExample(req, res, guestOnly) {
  const wordId = Number(req.params.id),
    libraryId = Number(req.query.libraryId);
  if (
    !Number.isInteger(wordId) ||
    !libraryId ||
    (guestOnly
      ? !(
          await pool.query(
            'SELECT id FROM word_libraries WHERE id=? AND library_type="SYSTEM"',
            [libraryId],
          )
        )[0].length
      : !(await allowedLibrary(req.session.userId, libraryId)))
  )
    return res.status(404).json({ message: "单词不存在" });
  const [[word]] = await pool.query(
    "SELECT id,word,example_en AS exampleEn,example_cn AS exampleCn FROM words WHERE id=? AND library_id=?",
    [wordId, libraryId],
  );
  if (!word) return res.status(404).json({ message: "单词不存在" });
  const generic =
    /I learned the word|useful in daily life|We often .* when we work together|It was a very .* day/i;
  if (word.exampleEn && word.exampleCn && !generic.test(word.exampleEn))
    return res.json({ exampleEn: word.exampleEn, exampleCn: word.exampleCn });
  try {
    const found = await lookupExample(word.word);
    if (!found)
      return res.status(404).json({ message: "暂未找到合适的双语例句" });
    await pool.execute(
      "UPDATE words SET example_en=?,example_cn=? WHERE id=?",
      [found.exampleEn, found.exampleCn, word.id],
    );
    res.json(found);
  } catch (error) {
    console.warn("例句查询失败：", error.message);
    res.status(502).json({ message: "例句服务暂时不可用" });
  }
}
app.get(
  "/api/guest/libraries",
  guestReadLimit,
  async (_req, res) => {
    const [libraries] = await pool.query(
      'SELECT id,code,name,library_type AS libraryType,(SELECT COUNT(*) FROM words w WHERE w.library_id=l.id) AS wordCount FROM word_libraries l WHERE l.library_type="SYSTEM" ORDER BY FIELD(l.code,"PRIMARY","JUNIOR","SENIOR","POSTGRAD","IELTS","CET4","CET6")',
    );
    res.json({ libraries, selectedLibraryId: libraries[0]?.id || null });
  },
);
app.get("/api/guest/words", guestReadLimit, async (req, res) => {
  const libraryId = Number(req.query.libraryId);
  const [[library]] = await pool.query(
    'SELECT id FROM word_libraries WHERE id=? AND library_type="SYSTEM"',
    [libraryId],
  );
  if (!library) return res.status(404).json({ message: "词库不存在" });
  const [rows] = await pool.query(
    "SELECT id,word,phonetic,meaning,example_en AS exampleEn,example_cn AS exampleCn,source,audio_url AS audioUrl FROM words WHERE library_id=? ORDER BY id",
    [libraryId],
  );
  res.json(rows);
});
app.get(
  "/api/guest/words/:id/example",
  guestReadLimit,
  async (req, res) => serveWordExample(req, res, true),
);
app.get("/api/progress", requireUser, async (req, res) => {
  const libraryId = Number(req.query.libraryId);
  if (!libraryId || !(await allowedLibrary(req.session.userId, libraryId)))
    return res.status(404).json({ message: "词库不存在" });
  const [[p]] = await pool.query(
    "SELECT unit_size AS unitSize,last_unit AS lastUnit,streak,mastered_json AS mastered,wrong_json AS wrong FROM library_progress WHERE user_id=? AND library_id=?",
    [req.session.userId, libraryId],
  );
  if (p) {
    p.mastered =
      typeof p.mastered === "string" ? JSON.parse(p.mastered) : p.mastered;
    p.wrong = typeof p.wrong === "string" ? JSON.parse(p.wrong) : p.wrong;
  }
  const [perfectCounts] = await pool.query(
    "SELECT unit_index AS unitIndex,mode,perfect_count AS perfectCount FROM unit_perfect_counts WHERE user_id=? AND library_id=? AND unit_size=?",
    [req.session.userId, libraryId, p?.unitSize || 20],
  );
  res.json(
    {
      ...(p || {
        unitSize: 20,
        lastUnit: 0,
        streak: 0,
        mastered: [],
        wrong: [],
      }),
      perfectCounts,
    },
  );
});
app.put("/api/progress", requireUser, async (req, res) => {
  const s = z.object({
      libraryId: z.number().int().positive(),
      unitSize: z.number().int().min(5).max(100),
      lastUnit: z.number().int().min(0),
      streak: z.number().int().min(0),
      mastered: z.array(z.number().int().positive()),
      wrong: z.array(z.number().int().positive()),
    }),
    p = s.safeParse(req.body);
  if (
    !p.success ||
    !(await allowedLibrary(req.session.userId, p.data.libraryId))
  )
    return res.status(400).json({ message: "进度数据不正确" });
  const d = p.data;
  await pool.execute(
    "INSERT INTO library_progress(user_id,library_id,unit_size,last_unit,streak,mastered_json,wrong_json) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE unit_size=VALUES(unit_size),last_unit=VALUES(last_unit),streak=VALUES(streak),mastered_json=VALUES(mastered_json),wrong_json=VALUES(wrong_json)",
    [
      req.session.userId,
      d.libraryId,
      d.unitSize,
      d.lastUnit,
      d.streak,
      JSON.stringify(d.mastered),
      JSON.stringify(d.wrong),
    ],
  );
  res.status(204).end();
});

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

async function pkRankings(challengeId) {
  const [rows] = await pool.query(
    `SELECT p.user_id AS userId,u.username,p.total_ms AS totalMs,p.completed_at AS completedAt
     FROM pk_participants p JOIN users u ON u.id=p.user_id
     WHERE p.challenge_id=? AND p.completed_at IS NOT NULL
     ORDER BY p.total_ms ASC,p.completed_at ASC LIMIT 200`,
    [challengeId],
  );
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

app.delete("/api/pk-challenges/:id", requireAdmin, async (req, res) => {
  const [result] = await pool.execute("DELETE FROM pk_challenges WHERE id=?", [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: "PK 挑战不存在" });
  res.json({ ok: true });
});
app.get("/api/pk-challenges", requireUser, async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM pk_challenges WHERE end_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)");
  const [rows] = await pool.query(
    `SELECT c.id,c.name,c.start_at AS startAt,c.end_at AS endAt,
            c.word_count AS wordCount,l.name AS libraryName,u.username AS creator,
            CASE WHEN UTC_TIMESTAMP()<c.start_at THEN 'UPCOMING'
                 WHEN UTC_TIMESTAMP()<=c.end_at THEN 'ACTIVE' ELSE 'ENDED' END AS status,
            (SELECT COUNT(*) FROM pk_participants p WHERE p.challenge_id=c.id) AS participantCount,
            mine.started_at AS myStartedAt,mine.completed_at AS myCompletedAt,
            mine.total_ms AS myTotalMs
     FROM pk_challenges c
     JOIN users u ON u.id=c.creator_user_id
     JOIN word_libraries l ON l.id=c.library_id
     LEFT JOIN pk_participants mine ON mine.challenge_id=c.id AND mine.user_id=?
     WHERE c.end_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)
     ORDER BY (UTC_TIMESTAMP() BETWEEN c.start_at AND c.end_at) DESC,c.start_at ASC,c.id DESC
     LIMIT 3 OFFSET ?`,
    [req.session.userId, (page - 1) * 3],
  );
  res.json({ items: rows, page, pages: Math.max(1, Math.ceil(count.total / 3)) });
});

app.post("/api/pk-challenges", requireUser, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(100),
      libraryId: z.number().int().positive(),
      wordCount: z.number().int().min(20).max(100),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "PK 信息填写不完整" });
  const data = parsed.data,
    startAt = new Date(data.startAt),
    endAt = new Date(data.endAt);
  if (endAt <= startAt || endAt <= new Date())
    return res.status(400).json({ message: "结束时间必须晚于开始时间和当前时间" });
  const library = await allowedLibrary(
    req.session.userId,
    data.libraryId,
  );
  if (!library) return res.status(404).json({ message: "词库不存在" });
  const [existing] = await pool.query(
    "SELECT id FROM words WHERE library_id=?",
    [data.libraryId],
  );
  const ids = existing.map((row) => Number(row.id));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  if (ids.length < data.wordCount)
    return res.status(400).json({
      message: `所选词库只有 ${ids.length} 个单词，不足 ${data.wordCount} 个`,
    });
  const chosen = ids.slice(0, data.wordCount);
  const [result] = await pool.execute(
    "INSERT INTO pk_challenges(creator_user_id,library_id,name,start_at,end_at,word_count,word_ids) VALUES(?,?,?,?,?,?,?)",
    [
      req.session.userId,
      data.libraryId,
      data.name,
      startAt,
      endAt,
      data.wordCount,
      JSON.stringify(chosen),
    ],
  );
  await logEvent(req, "PK_CREATE", { challengeId: result.insertId });
  res.status(201).json({ id: result.insertId });
});

app.get("/api/pk-challenges/:id", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  const [[challenge]] = await pool.query(
    `SELECT c.id,c.name,c.start_at AS startAt,c.end_at AS endAt,
            c.word_count AS wordCount,l.name AS libraryName,u.username AS creator,
            CASE WHEN UTC_TIMESTAMP()<c.start_at THEN 'UPCOMING'
                 WHEN UTC_TIMESTAMP()<=c.end_at THEN 'ACTIVE' ELSE 'ENDED' END AS status
     FROM pk_challenges c JOIN users u ON u.id=c.creator_user_id
     JOIN word_libraries l ON l.id=c.library_id WHERE c.id=?`,
    [id],
  );
  if (!challenge) return res.status(404).json({ message: "PK 挑战不存在" });
  const [[mine]] = await pool.query(
    "SELECT started_at AS startedAt,completed_at AS completedAt,total_ms AS totalMs FROM pk_participants WHERE challenge_id=? AND user_id=?",
    [id, req.session.userId],
  );
  res.json({ ...challenge, mine: mine || null, rankings: await pkRankings(id) });
});

app.post("/api/pk-challenges/:id/start", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  const [[challenge]] = await pool.query(
    "SELECT id,word_ids AS wordIds,start_at AS startAt,end_at AS endAt FROM pk_challenges WHERE id=?",
    [id],
  );
  if (!challenge) return res.status(404).json({ message: "PK 挑战不存在" });
  const now = new Date();
  if (now < new Date(challenge.startAt))
    return res.status(409).json({ message: "PK 挑战尚未开始" });
  if (now > new Date(challenge.endAt))
    return res.status(409).json({ message: "PK 挑战已经结束" });
  await pool.execute(
    "INSERT INTO pk_participants(challenge_id,user_id,started_at) VALUES(?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE started_at=UTC_TIMESTAMP(),completed_at=NULL,total_ms=2147483647",
    [id, req.session.userId],
  );
  const [[participant]] = await pool.query(
    "SELECT started_at AS startedAt,completed_at AS completedAt,total_ms AS totalMs FROM pk_participants WHERE challenge_id=? AND user_id=?",
    [id, req.session.userId],
  );
  const wordIds = jsonArray(challenge.wordIds).map(Number),
    placeholders = wordIds.map(() => "?").join(",");
  const [words] = await pool.query(
    `SELECT id,word,phonetic,meaning,audio_url AS audioUrl FROM words WHERE id IN (${placeholders})`,
    wordIds,
  );
  const byId = new Map(words.map((word) => [Number(word.id), word]));
  const ordered = wordIds.map((wordId) => byId.get(wordId)).filter(Boolean);
  if (ordered.length !== wordIds.length)
    return res.status(409).json({ message: "挑战中的部分单词已不存在" });
  await logEvent(req, "PK_START", { challengeId: id });
  res.json({ words: ordered, startedAt: participant.startedAt });
});

app.post("/api/pk-challenges/:id/complete", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  const [[participant]] = await pool.query(
    `SELECT p.started_at AS startedAt,p.completed_at AS completedAt,c.end_at AS endAt
     FROM pk_participants p JOIN pk_challenges c ON c.id=p.challenge_id
     WHERE p.challenge_id=? AND p.user_id=?`,
    [id, req.session.userId],
  );
  if (!participant) return res.status(409).json({ message: "请先开始挑战" });
  if (new Date() > new Date(participant.endAt))
    return res.status(409).json({ message: "挑战时间已结束，本次不计成绩" });
  const totalMs = Math.max(1, Date.now() - new Date(participant.startedAt).getTime());
  await pool.execute(
    "UPDATE pk_participants SET completed_at=UTC_TIMESTAMP(),total_ms=? WHERE challenge_id=? AND user_id=? AND completed_at IS NULL",
    [totalMs, id, req.session.userId],
  );
  await logEvent(req, "PK_COMPLETE", { challengeId: id, totalMs });
  const rankings = await pkRankings(id),
    mine = rankings.find((row) => Number(row.userId) === Number(req.session.userId));
  res.json({ totalMs, rank: mine?.rank || null, rankings });
});

app.post("/api/attempts", requireUser, async (req, res) => {
  const s = z.object({
      libraryId: z.number().int().positive(),
      wordId: z.number().int().positive(),
      correct: z.boolean(),
      mode: z.enum(["memory", "dictation", "quiz", "spelling"]),
      unitIndex: z.number().int().nonnegative(),
      answer: z.string().max(255).optional(),
    }),
    p = s.safeParse(req.body);
  if (
    !p.success ||
    !(await allowedLibrary(req.session.userId, p.data.libraryId))
  )
    return res.status(400).json({ message: "答题数据不正确" });
  const d = p.data;
  await pool.execute(
    "INSERT INTO answer_attempts(user_id,library_id,word_id,mode,unit_index,answer,correct) VALUES(?,?,?,?,?,?,?)",
    [
      req.session.userId,
      d.libraryId,
      d.wordId,
      d.mode,
      d.unitIndex,
      d.answer || null,
      d.correct,
    ],
  );
  const [[user]] = await pool.query("SELECT score FROM users WHERE id=?", [
    req.session.userId,
  ]);
  res.status(201).json({ ok: true, earned: 0, score: user.score });
});
app.post("/api/study/complete", requireUser, async (req, res) => {
  const p = z
    .object({
      libraryId: z.number().int().positive(),
      mode: z.enum(["dictation", "quiz", "spelling"]),
      unitIndex: z.number().int().nonnegative(),
      unitSize: z.number().int().min(5).max(100),
      allCorrect: z.boolean(),
    })
    .safeParse(req.body);
  if (
    !p.success ||
    !(await allowedLibrary(req.session.userId, p.data.libraryId))
  )
    return res.status(400).json({ message: "完成数据不正确" });
  if (p.data.allCorrect) {
    await pool.execute("UPDATE users SET score=score+1 WHERE id=?", [
      req.session.userId,
    ]);
    await pool.execute(
      "INSERT INTO unit_perfect_counts(user_id,library_id,unit_size,unit_index,mode,perfect_count) VALUES(?,?,?,?,?,1) ON DUPLICATE KEY UPDATE perfect_count=perfect_count+1",
      [
        req.session.userId,
        p.data.libraryId,
        p.data.unitSize,
        p.data.unitIndex,
        p.data.mode,
      ],
    );
  }
  const [[user]] = await pool.query("SELECT score FROM users WHERE id=?", [
    req.session.userId,
  ]);
  await logEvent(req, "STUDY_ROUND_COMPLETE", {
    libraryId: p.data.libraryId,
    unitIndex: p.data.unitIndex,
    mode: p.data.mode,
    allCorrect: p.data.allCorrect,
  });
  res.json({
    earned: p.data.allCorrect ? 1 : 0,
    score: user.score,
    message: p.data.allCorrect ? "全对啦，已加积分！" : "本轮有答错的单词，已加入错题本。",
  });
});
app.post("/api/study/heartbeat", requireUser, async (req, res) => {
  const p = z
    .object({ seconds: z.number().int().min(1).max(60) })
    .safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ message: "在线时长参数不正确" });
  await pool.execute(
    "UPDATE users SET study_seconds=study_seconds+? WHERE id=?",
    [p.data.seconds, req.session.userId],
  );
  const [[u]] = await pool.query(
    "SELECT study_seconds AS studySeconds,redeemed_pets AS redeemedPets FROM users WHERE id=?",
    [req.session.userId],
  );
  res.json({
    studySeconds: u.studySeconds,
    redeemedPets: u.redeemedPets,
    petCount: Math.max(
      0,
      1 + Math.floor(u.studySeconds / 300) - u.redeemedPets,
    ),
  });
});
app.post("/api/pets/redeem", requireUser, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.query(
      "SELECT score,study_seconds AS studySeconds,redeemed_pets AS redeemedPets FROM users WHERE id=? FOR UPDATE",
      [req.session.userId],
    );
    const totalPets = 1 + Math.floor(user.studySeconds / 300),
      available = Math.max(0, totalPets - user.redeemedPets);
    if (!available) {
      await connection.rollback();
      return res.status(400).json({ message: "当前没有可以回归的宠物" });
    }
    await connection.execute(
      "UPDATE users SET score=score+?,redeemed_pets=redeemed_pets+? WHERE id=?",
      [available, available, req.session.userId],
    );
    await connection.commit();
    await logEvent(req, "PETS_REDEEMED", { count: available });
    res.json({
      redeemed: available,
      score: user.score + available,
      redeemedPets: user.redeemedPets + available,
      message: `${available} 只宠物已回归，获得 ${available} 积分！`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});
app.get("/api/leaderboard", requireUser, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1),
    pageSize = 10,
    [[count]] = await pool.query(
      'SELECT COUNT(*) AS total FROM users WHERE status="ACTIVE"',
    ),
    [items] = await pool.query(
      'SELECT username,score FROM users WHERE status="ACTIVE" ORDER BY score DESC,id ASC LIMIT ? OFFSET ?',
      [pageSize, (page - 1) * pageSize],
    );
  res.json({
    items: items.map((item, index) => ({
      ...item,
      rank: (page - 1) * pageSize + index + 1,
    })),
    page,
    pages: Math.max(1, Math.ceil(count.total / pageSize)),
  });
});
app.post("/api/study/game-complete", requireUser, async (req, res) => {
  const p = z
    .object({ libraryId: z.number().int().positive() })
    .safeParse(req.body);
  if (
    !p.success ||
    !(await allowedLibrary(req.session.userId, p.data.libraryId))
  )
    return res.status(400).json({ message: "游戏完成数据不正确" });
  await pool.execute("UPDATE users SET score=score+1 WHERE id=?", [
    req.session.userId,
  ]);
  const [[user]] = await pool.query("SELECT score FROM users WHERE id=?", [
    req.session.userId,
  ]);
  await logEvent(req, "WORD_GAME_COMPLETE", { libraryId: p.data.libraryId });
  res.json({ score: user.score, message: "怪物全部消灭，获得 1 积分！" });
});
app.get("/api/messages", requireUser, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1),
    pageSize = 5,
    [[count]] = await pool.query("SELECT COUNT(*) AS total FROM messages"),
    [items] = await pool.query(
      "SELECT m.id,m.user_id AS userId,m.content,m.created_at AS createdAt,u.username FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT ? OFFSET ?",
      [pageSize, (page - 1) * pageSize],
    );
  res.json({
    items,
    total: count.total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(count.total / pageSize)),
  });
});
app.post("/api/messages", requireUser, async (req, res) => {
  const p = z
    .object({ content: z.string().trim().min(1).max(100) })
    .safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ message: "留言内容应为 1 至 100 个字" });
  await pool.execute("INSERT INTO messages(user_id,content) VALUES(?,?)", [
    req.session.userId,
    p.data.content,
  ]);
  await logEvent(req, "MESSAGE_ADD");
  res.status(201).json({ ok: true });
});
app.delete("/api/messages/:id", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "留言参数不正确" });
  const [[user]] = await pool.query("SELECT role FROM users WHERE id=?", [
    req.session.userId,
  ]);
  const [result] =
    user.role === "ADMIN"
      ? await pool.execute("DELETE FROM messages WHERE id=?", [id])
      : await pool.execute("DELETE FROM messages WHERE id=? AND user_id=?", [
          id,
          req.session.userId,
        ]);
  if (!result.affectedRows)
    return res.status(404).json({ message: "留言不存在或无权删除" });
  await logEvent(req, "MESSAGE_DELETE", { messageId: id });
  res.status(204).end();
});

app.get("/api/user-library/words", requireUser, async (req, res) => {
  const id = await ensureUserLibrary(req.session.userId);
  const [rows] = await pool.query(
    "SELECT id,word,phonetic,meaning,example_en AS exampleEn,example_cn AS exampleCn,source,audio_url AS audioUrl FROM words WHERE library_id=? ORDER BY updated_at DESC",
    [id],
  );
  res.json(rows);
});
app.get("/api/word-search", requireUser, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 1) return res.json([]);
  const [rows] = await pool.query(
    'SELECT w.id,w.word,w.phonetic,w.meaning,w.example_en AS exampleEn,w.example_cn AS exampleCn,w.audio_url AS audioUrl,l.name AS libraryName FROM words w JOIN word_libraries l ON l.id=w.library_id WHERE l.library_type="SYSTEM" AND w.word LIKE ? ORDER BY (w.word=? ) DESC,w.word LIMIT 50',
    [`%${q}%`, q],
  );
  res.json(rows);
});
app.get("/api/word-search/internet", requireUser, async (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z '-]{0,60}$/.test(q))
    return res.status(400).json({ message: "请输入有效英文单词" });
  try {
    const response = await fetch(
      `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(q)}`,
      {
        headers: {
          "user-agent": "Mozilla/5.0 WordHop/1.0",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.ok) {
      const data = await response.json(),
        word = data.ec?.word?.[0],
        translations = (word?.trs || [])
          .flatMap((item) => item.tr || [])
          .flatMap((item) => item.l?.i || [])
          .filter(Boolean)
          .slice(0, 8),
        sentence = data.blng_sents_part?.["sentence-pair"]?.[0];
      if (translations.length)
        return res.json({
          word: q,
          phonetic: word.usphone
            ? `/${word.usphone}/`
            : word.ukphone
              ? `/${word.ukphone}/`
              : "",
          meaning: translations.join("；"),
          exampleEn: sentence?.sentence || "",
          exampleCn: sentence?.["sentence-translation"] || "",
          source: "INTERNET",
        });
    }
  } catch (error) {
    console.warn("有道词典查询失败：", error.message);
  }
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok)
      return res.status(404).json({ message: "互联网词典未找到该单词" });
    const [entry] = await response.json(),
      meaning =
        entry.meanings?.flatMap(
          (m) =>
            m.definitions?.map((d) => `${m.partOfSpeech}. ${d.definition}`) ||
            [],
        )[0] || "",
      example =
        entry.meanings
          ?.flatMap((m) => m.definitions || [])
          .find((d) => d.example)?.example || "";
    res.json({
      word: entry.word || q,
      phonetic:
        entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || "",
      meaning,
      exampleEn: example,
      exampleCn: "",
      source: "INTERNET",
    });
  } catch {
    return res
      .status(502)
      .json({ message: "互联网词典暂时不可用，请稍后重试" });
  }
});
const wordBody = z.object({
  word: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z][a-zA-Z '-]*$/),
  phonetic: z.string().max(255).optional().default(""),
  meaning: z.string().trim().min(1).max(4000),
  exampleEn: z.string().max(4000).optional().default(""),
  exampleCn: z.string().max(4000).optional().default(""),
  source: z.enum(["MANUAL", "BASE", "INTERNET"]).optional().default("MANUAL"),
});
app.post("/api/user-library/words", requireUser, async (req, res) => {
  const p = wordBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: "单词数据不正确" });
  const libraryId = await ensureUserLibrary(req.session.userId),
    d = p.data;
  try {
    const audio = await ensureWordAudio(d.word);
    const [r] = await pool.execute(
      "INSERT INTO words(library_id,word,phonetic,meaning,example_en,example_cn,source,audio_url) VALUES(?,?,?,?,?,?,?,?)",
      [
        libraryId,
        d.word.toLowerCase(),
        d.phonetic,
        d.meaning,
        d.exampleEn,
        d.exampleCn,
        d.source,
        audio.audioUrl,
      ],
    );
    if (audio.audioUrl)
      await pool.execute(
        "UPDATE words SET audio_url=? WHERE LOWER(word)=LOWER(?) AND (audio_url IS NULL OR audio_url='')",
        [audio.audioUrl, d.word],
      );
    await logEvent(req, "USER_WORD_ADD", {
      wordId: r.insertId,
      word: d.word,
      audioDownloaded: audio.downloaded,
    });
    res.status(201).json({
      id: r.insertId,
      audioUrl: audio.audioUrl,
      audioDownloaded: audio.downloaded,
      message: audio.audioUrl
        ? audio.downloaded
          ? "单词及发音已保存到用户库"
          : "单词已保存，并已关联现有发音"
        : "单词已保存；暂未下载到发音，听写时将显示中文",
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "用户库中已存在该单词" });
    throw e;
  }
});
app.put("/api/user-library/words/:id", requireUser, async (req, res) => {
  const p = wordBody.safeParse(req.body),
    id = Number(req.params.id),
    libraryId = await ensureUserLibrary(req.session.userId);
  if (!p.success) return res.status(400).json({ message: "单词数据不正确" });
  const d = p.data,
    [r] = await pool.execute(
      "UPDATE words SET word=?,phonetic=?,meaning=?,example_en=?,example_cn=?,source=? WHERE id=? AND library_id=?",
      [
        d.word.toLowerCase(),
        d.phonetic,
        d.meaning,
        d.exampleEn,
        d.exampleCn,
        d.source,
        id,
        libraryId,
      ],
    );
  if (!r.affectedRows) return res.status(404).json({ message: "单词不存在" });
  await logEvent(req, "USER_WORD_EDIT", { wordId: id });
  res.json({ ok: true });
});

async function wordHasLearningData(wordId) {
  const jsonWordId = JSON.stringify(wordId);
  const [[row]] = await pool.execute(
    `SELECT
       EXISTS(SELECT 1 FROM answer_attempts WHERE word_id=? LIMIT 1) AS has_attempts,
       EXISTS(
         SELECT 1 FROM library_progress
         WHERE JSON_CONTAINS(mastered_json, ?, '$')
            OR JSON_CONTAINS(wrong_json, ?, '$')
         LIMIT 1
       ) AS has_library_progress,
       EXISTS(
         SELECT 1 FROM learning_progress
         WHERE JSON_CONTAINS(mastered_json, ?, '$')
            OR JSON_CONTAINS(wrong_json, ?, '$')
         LIMIT 1
       ) AS has_legacy_progress`,
    [wordId, jsonWordId, jsonWordId, jsonWordId, jsonWordId],
  );
  return Boolean(
    row.has_attempts || row.has_library_progress || row.has_legacy_progress,
  );
}

app.delete("/api/user-library/words/:id", requireUser, async (req, res) => {
  const id = Number(req.params.id),
    libraryId = await ensureUserLibrary(req.session.userId);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "单词参数不正确" });
  if (await wordHasLearningData(id))
    return res.status(409).json({
      message: "该单词已有学习进度或答题记录，不能删除",
    });
  const [r] = await pool.execute(
    "DELETE FROM words WHERE id=? AND library_id=?",
    [id, libraryId],
  );
  if (!r.affectedRows) return res.status(404).json({ message: "单词不存在" });
  await logEvent(req, "USER_WORD_DELETE", { wordId: id });
  res.status(204).end();
});

const adminWordBody = wordBody.extend({
  libraryId: z.number().int().positive(),
  source: z
    .enum(["LOCAL", "MANUAL", "BASE", "INTERNET"])
    .optional()
    .default("MANUAL"),
});
app.get("/api/admin/word-libraries", requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT l.id,l.code,l.name,l.library_type AS libraryType,l.owner_user_id AS ownerUserId,
      u.username,(SELECT COUNT(*) FROM words w WHERE w.library_id=l.id) AS wordCount
     FROM word_libraries l LEFT JOIN users u ON u.id=l.owner_user_id
     ORDER BY (l.library_type="USER"),l.name,u.username`,
  );
  res.json(rows);
});
app.get("/api/admin/words", requireAdmin, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page) || 1),
    pageSize = 20,
    libraryId = Number(req.query.libraryId) || 0,
    word = String(req.query.word || "").trim().slice(0, 120),
    meaning = String(req.query.meaning || "").trim().slice(0, 120),
    clauses = [],
    params = [];
  if (libraryId) {
    clauses.push("w.library_id=?");
    params.push(libraryId);
  }
  if (word) {
    clauses.push("w.word LIKE ?");
    params.push(`%${word}%`);
  }
  if (meaning) {
    clauses.push("w.meaning LIKE ?");
    params.push(`%${meaning}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total FROM words w ${where}`,
    params,
  );
  const [items] = await pool.query(
    `SELECT w.id,w.library_id AS libraryId,w.word,w.phonetic,w.meaning,
      w.example_en AS exampleEn,w.example_cn AS exampleCn,w.source,
      w.audio_url AS audioUrl,w.updated_at AS updatedAt,l.name AS libraryName,
      l.library_type AS libraryType,u.username AS ownerUsername
     FROM words w JOIN word_libraries l ON l.id=w.library_id
     LEFT JOIN users u ON u.id=l.owner_user_id
     ${where} ORDER BY w.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  await Promise.all(items.map(async (item) => {
    item.audioExists = false;
    if (!item.audioUrl?.startsWith("/audio/words/")) return;
    try {
      const filename = decodeURIComponent(item.audioUrl.slice("/audio/words/".length));
      if (path.basename(filename) !== filename) return;
      item.audioExists = looksLikeMp3(await fs.readFile(path.join(audioDirectory, filename)));
    } catch {}
  }));
  res.json({
    items,
    page,
    pages: Math.max(1, Math.ceil(Number(count.total) / pageSize)),
    total: Number(count.total),
  });
});
app.post("/api/admin/words", requireAdmin, async (req, res) => {
  const parsed = adminWordBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "单词数据不正确" });
  const data = parsed.data;
  const [[library]] = await pool.query(
    "SELECT id FROM word_libraries WHERE id=?",
    [data.libraryId],
  );
  if (!library) return res.status(404).json({ message: "词库不存在" });
  try {
    const audio = await ensureWordAudio(data.word);
    const [result] = await pool.execute(
      `INSERT INTO words(library_id,word,phonetic,meaning,example_en,example_cn,source,audio_url)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        data.libraryId,
        data.word.toLowerCase(),
        data.phonetic,
        data.meaning,
        data.exampleEn,
        data.exampleCn,
        data.source,
        audio.audioUrl,
      ],
    );
    await logEvent(req, "ADMIN_WORD_ADD", {
      wordId: result.insertId,
      libraryId: data.libraryId,
      word: data.word,
    });
    res.status(201).json({ id: result.insertId, audioUrl: audio.audioUrl });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "该词库中已存在这个单词" });
    throw error;
  }
});
app.put("/api/admin/words/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id),
    parsed = adminWordBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success)
    return res.status(400).json({ message: "单词数据不正确" });
  const data = parsed.data;
  const [[existing]] = await pool.query(
    "SELECT id,word,audio_url AS audioUrl FROM words WHERE id=?",
    [id],
  );
  if (!existing) return res.status(404).json({ message: "单词不存在" });
  try {
    let audioUrl = existing.audioUrl;
    if (!audioUrl || existing.word.toLowerCase() !== data.word.toLowerCase())
      audioUrl = (await ensureWordAudio(data.word)).audioUrl;
    await pool.execute(
      `UPDATE words SET library_id=?,word=?,phonetic=?,meaning=?,example_en=?,
       example_cn=?,source=?,audio_url=? WHERE id=?`,
      [
        data.libraryId,
        data.word.toLowerCase(),
        data.phonetic,
        data.meaning,
        data.exampleEn,
        data.exampleCn,
        data.source,
        audioUrl,
        id,
      ],
    );
    await logEvent(req, "ADMIN_WORD_EDIT", {
      wordId: id,
      libraryId: data.libraryId,
      word: data.word,
    });
    res.json({ ok: true, audioUrl });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "该词库中已存在这个单词" });
    throw error;
  }
});
app.delete("/api/admin/words/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "单词参数不正确" });
  if (await wordHasLearningData(id))
    return res.status(409).json({
      message: "该单词已有学习进度或答题记录，不能删除",
    });
  const [result] = await pool.execute("DELETE FROM words WHERE id=?", [id]);
  if (!result.affectedRows)
    return res.status(404).json({ message: "单词不存在" });
  await logEvent(req, "ADMIN_WORD_DELETE", { wordId: id });
  res.status(204).end();
});

app.post("/api/events", requireUser, async (req, res) => {
  const p = z
    .object({
      eventType: z.string().min(1).max(50),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(req.body);
  if (!p.success) return res.status(400).end();
  await logEvent(req, p.data.eventType, p.data.metadata || {});
  res.status(201).json({ ok: true });
});
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page) || 1),
    pageSize = 15,
    [[count]] = await pool.query("SELECT COUNT(*) AS total FROM users"),
    [rows] = await pool.query(
      'SELECT id,username,name,phone,email,email_verified_at AS emailVerifiedAt,role,status,created_at AS createdAt,approved_at AS approvedAt,last_login_at AS lastLoginAt FROM users ORDER BY FIELD(status,"PENDING","ACTIVE","DISABLED"),id DESC LIMIT ? OFFSET ?',
      [pageSize, (page - 1) * pageSize],
    );
  res.json({
    items: rows,
    page,
    pages: Math.max(1, Math.ceil(Number(count.total) / pageSize)),
    total: Number(count.total),
  });
});
app.patch("/api/admin/users/status", requireAdmin, async (req, res) => {
  const p = z
    .object({
      userIds: z.array(z.number().int().positive()).min(1).max(200),
      status: z.enum(["ACTIVE", "DISABLED"]),
    })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: "审核参数不正确" });
  const ids = p.data.userIds.filter((id) => id !== req.session.userId);
  if (!ids.length)
    return res.status(400).json({ message: "不能修改当前管理员" });
  if (p.data.status === "ACTIVE") {
    const marks = ids.map(() => "?").join(","),
      [[unverified]] = await pool.query(
        `SELECT COUNT(*) AS total FROM users WHERE id IN (${marks}) AND email_verified_at IS NULL`,
        ids,
      );
    if (unverified.total)
      return res
        .status(400)
        .json({ message: "存在尚未完成邮箱验证的用户，不能审核通过" });
  }
  const marks = ids.map(() => "?").join(",");
  await pool.query(
    `UPDATE users SET status=?,approved_at=IF(?='ACTIVE',NOW(),approved_at),approved_by=? WHERE id IN (${marks}) AND role!='ADMIN'`,
    [p.data.status, p.data.status, req.session.userId, ...ids],
  );
  for (const id of ids) await ensureUserLibrary(id);
  await logEvent(req, "ADMIN_USER_AUDIT", {
    userIds: ids,
    status: p.data.status,
  });
  res.json({ ok: true });
});
app.post(
  "/api/admin/users/:id/reset-password",
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id),
      p = z
        .object({
          newPassword: z.string().min(8).max(100).optional().or(z.literal("")),
        })
        .safeParse(req.body);
    if (!Number.isInteger(userId) || !p.success)
      return res.status(400).json({ message: "重置参数不正确" });
    const [[user]] = await pool.query(
      "SELECT id,name,email,status,email_verified_at AS emailVerifiedAt,role FROM users WHERE id=?",
      [userId],
    );
    if (!user || user.role === "ADMIN")
      return res.status(404).json({ message: "用户不存在" });
    if (user.status !== "ACTIVE" || !user.email || !user.emailVerifiedAt)
      return res
        .status(400)
        .json({ message: "只能为邮箱已验证且状态正常的用户重置密码" });
    const password = p.data.newPassword || randomPassword();
    await sendNewPassword(user.email, user.name, password, "管理员重置密码");
    await pool.execute("UPDATE users SET password_hash=? WHERE id=?", [
      await bcrypt.hash(password, 12),
      user.id,
    ]);
    await logEvent(req, "ADMIN_PASSWORD_RESET", {
      userId: user.id,
      generated: !p.data.newPassword,
    });
    res.json({ message: "新密码已发送到用户邮箱" });
  },
);
app.get("/api/admin/logs", requireAdmin, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page) || 1),
    pageSize = 20,
    type = String(req.query.type || "").trim().slice(0, 50),
    keyword = String(req.query.keyword || "").trim().slice(0, 80),
    clauses = [],
    params = [];
  if (type) {
    clauses.push("e.event_type=?");
    params.push(type);
  }
  if (keyword) {
    clauses.push("(u.username LIKE ? OR e.ip_address LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total FROM user_events e LEFT JOIN users u ON u.id=e.user_id ${where}`,
    params,
  );
  const [rows] = await pool.query(
    `SELECT e.id,e.event_type AS eventType,e.metadata,e.ip_address AS ipAddress,e.user_agent AS userAgent,e.created_at AS createdAt,u.username,u.name FROM user_events e LEFT JOIN users u ON u.id=e.user_id ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const [types] = await pool.query(
    "SELECT DISTINCT event_type AS eventType FROM user_events ORDER BY event_type",
  );
  res.json({
    items: rows.map((r) => ({
      ...r,
      metadata:
        typeof r.metadata === "string"
          ? r.metadata
          : JSON.stringify(r.metadata || {}),
    })),
    page,
    pages: Math.max(1, Math.ceil(Number(count.total) / pageSize)),
    total: Number(count.total),
    types: types.map((item) => item.eventType),
  });
});


const noteBody = z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(50000) });
app.get("/api/notes", requireUser, async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM notes WHERE user_id=?", [req.session.userId]);
  const [items] = await pool.query("SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM notes WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET ?", [req.session.userId, (page-1)*10]);
  res.json({ items, page, pages: Math.max(1, Math.ceil(count.total/10)) });
});
app.get("/api/notes/:id", requireUser, async (req, res) => {
  const [[note]] = await pool.query("SELECT id,title,content,created_at AS createdAt FROM notes WHERE id=? AND user_id=?", [req.params.id, req.session.userId]);
  if (!note) return res.status(404).json({ message: "笔记不存在" });
  res.json(note);
});
for (const method of ["post", "put"]) app[method](method === "post" ? "/api/notes" : "/api/notes/:id", requireUser, async (req, res) => {
  const parsed = noteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "请输入标题，内容不能超过 50000 字符" });
  const { title } = parsed.data;
  const content = sanitizeHtml(parsed.data.content, { allowedTags: ["p","br","div","strong","b","i","em","u","s","h2","h3","ul","ol","li","blockquote","a"], allowedAttributes: { a: ["href","title"] }, allowedSchemes: ["https","http","mailto"] });
  if (method === "post") {
    const [result] = await pool.execute("INSERT INTO notes(user_id,title,content) VALUES(?,?,?)", [req.session.userId,title,content]);
    return res.status(201).json({ id: result.insertId });
  }
  const [result] = await pool.execute("UPDATE notes SET title=?,content=? WHERE id=? AND user_id=?", [title,content,req.params.id,req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ message: "笔记不存在" });
  res.json({ ok: true });
});
app.delete("/api/notes/:id", requireUser, async (req, res) => {
  const [result] = await pool.execute("DELETE FROM notes WHERE id=? AND user_id=?", [req.params.id,req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ message: "笔记不存在" });
  res.json({ ok: true });
});
app.put("/api/admin/words/:id/audio", requireAdmin, express.raw({ type: ["audio/*", "application/octet-stream"], limit: "10mb" }), async (req, res) => {
  const [[word]] = await pool.query("SELECT word FROM words WHERE id=?", [req.params.id]);
  if (!word) return res.status(404).json({ message: "单词不存在" });
  let buffer = req.body;
  if (!Buffer.isBuffer(buffer)) {
    let url;
    try { url = new URL(req.body.url); } catch { return res.status(400).json({ message: "请输入有效音频地址" }); }
    if (!["http:","https:"].includes(url.protocol)) return res.status(400).json({ message: "仅支持 HTTP/HTTPS 地址" });
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok || Number(response.headers.get("content-length")) > 10485760) throw new Error();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 10485760) throw new Error(); chunks.push(chunk); }
      buffer = Buffer.concat(chunks);
    } catch { return res.status(400).json({ message: "下载音频失败或文件超过 10MB" }); }
  }
  if (!looksLikeMp3(buffer)) return res.status(400).json({ message: "请提供有效的 MP3 音频文件" });
  const filename = `custom-${crypto.randomUUID()}.mp3`;
  await fs.mkdir(audioDirectory, { recursive: true });
  await fs.writeFile(path.join(audioDirectory,filename), buffer);
  const audioUrl = `/audio/words/${filename}`;
  await pool.execute("UPDATE words SET audio_url=? WHERE id=?", [audioUrl,req.params.id]);
  res.json({ audioUrl });
});

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
app.use(express.static(publicDir));
app.use((req, res, next) =>
  req.path.startsWith("/api/")
    ? next()
    : res.sendFile(path.join(publicDir, "index.html")),
);
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err)
    return res.status(400).json({ message: "请求数据格式不正确" });
  console.error(err);
  res.status(500).json({ message: "服务器内部错误" });
});
app.listen(port, () => console.log(`WordHop API: http://localhost:${port}`));
