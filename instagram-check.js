const { chromium } = require("playwright");
const fs = require("fs");

const SESSION_FILE = "instagram-session.json";
const RESULT_FILE = "not-following-back.json";
const FOLLOWERS_FILE = "followers.json";
const FOLLOWING_FILE = "following.json";

const USERNAME = "eto.me";

// ============================================================
// Получаем username из href
// ============================================================

function getUsernameFromHref(href) {
  if (!href) return null;

  try {
    const url = new URL(href, "https://www.instagram.com");

    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length !== 1) {
      return null;
    }

    const username = parts[0];

    const ignored = [
      "accounts",
      "explore",
      "reels",
      "direct",
      "stories",
      "about",
      "developer",
    ];

    if (ignored.includes(username.toLowerCase())) {
      return null;
    }

    return username;
  } catch {
    return null;
  }
}

// ============================================================
// Получаем пользователей из открытого окна
// ============================================================

async function getVisibleUsers(container) {
  const links = await container.locator("a").evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute("href"),
      text: element.innerText?.trim() || "",
    })),
  );

  const users = [];

  for (const link of links) {
    const username = getUsernameFromHref(link.href);

    if (!username) {
      continue;
    }

    users.push({
      username,
      name: link.text || null,
      url: `https://www.instagram.com/${username}/`,
    });
  }

  return users;
}

// ============================================================
// Ищем скроллящийся контейнер
// ============================================================

async function findScrollableContainer(page) {
  const result = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("div"));

    const candidates = elements
      .map((element, index) => {
        const style = window.getComputedStyle(element);

        return {
          index,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
        };
      })
      .filter(
        (item) =>
          item.scrollHeight > item.clientHeight + 100 &&
          item.clientHeight > 100,
      )
      .sort(
        (a, b) =>
          b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
      );

    return candidates[0]?.index ?? null;
  });

  if (result === null) {
    return null;
  }

  return page.locator("div").nth(result);
}

// ============================================================
// Собираем весь список
// ============================================================

async function collectUsers(page, type, expectedCount) {
  console.log(`\nПолучаем ${type}...`);

  await page.waitForTimeout(2000);

  // ----------------------------------------------------------
  // Ищем окно со списком
  // ----------------------------------------------------------

  let container;

  const dialog = page.locator('[role="dialog"]');

  if (await dialog.count()) {
    console.log("✓ Найден dialog");
    container = dialog.last();
  } else {
    console.log("Dialog отсутствует, ищем scroll container...");

    container = await findScrollableContainer(page);
  }

  if (!container) {
    throw new Error(`Не удалось найти контейнер ${type}`);
  }

  // ----------------------------------------------------------
  // Собираем пользователей
  // ----------------------------------------------------------

  const users = new Map();

  let previousSize = 0;
  let noChanges = 0;

  const MAX_NO_CHANGES = 8;
  const MAX_ITERATIONS = 200;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const visibleUsers = await getVisibleUsers(container);

    for (const user of visibleUsers) {
      users.set(user.username.toLowerCase(), user);
    }

    console.log(
      `${type}: ${users.size}` + (expectedCount ? ` / ${expectedCount}` : ""),
    );

    // Если получили ожидаемое количество
    if (expectedCount && users.size >= expectedCount) {
      console.log(`✓ Получено ожидаемое количество ${type}`);

      break;
    }

    if (users.size === previousSize) {
      noChanges++;
    } else {
      noChanges = 0;
    }

    previousSize = users.size;

    if (noChanges >= MAX_NO_CHANGES) {
      console.log("Новые пользователи больше не появляются.");

      break;
    }

    // --------------------------------------------------------
    // Скроллим
    // --------------------------------------------------------

    try {
      const lastLink = container.locator("a").last();

      if (await lastLink.count()) {
        await lastLink.scrollIntoViewIfNeeded();
      }

      await container.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    } catch {
      await page.mouse.wheel(0, 1500);
    }

    await page.waitForTimeout(1200);
  }

  return Array.from(users.values());
}

// ============================================================
// Открываем Followers / Following
// ============================================================

async function openFollowList(page, type) {
  let locator;

  if (type === "followers") {
    locator = page
      .locator("a")
      .filter({
        hasText: /подписчик/i,
      })
      .first();
  } else {
    locator = page
      .locator("a")
      .filter({
        hasText: /подписок/i,
      })
      .first();
  }

  await locator.waitFor({
    state: "visible",
    timeout: 15000,
  });

  console.log(`Кликаем ${type}...`);

  await locator.click();

  await page.waitForTimeout(2500);
}

// ============================================================
// Закрываем список
// ============================================================

async function closeFollowList(page) {
  await page.keyboard.press("Escape");

  await page.waitForTimeout(1500);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error(`❌ ${SESSION_FILE} не найден.`);

    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
  });

  const page = await context.newPage();

  // ----------------------------------------------------------
  // Открываем профиль
  // ----------------------------------------------------------

  console.log(`Открываем профиль @${USERNAME}...`);

  await page.goto(`https://www.instagram.com/${USERNAME}/`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(5000);

  console.log(`URL: ${page.url()}`);

  // ----------------------------------------------------------
  // Проверяем авторизацию
  // ----------------------------------------------------------

  const pageText = await page.locator("body").innerText();

  if (
    pageText.includes("Войти") &&
    !pageText.includes("Редактировать профиль")
  ) {
    throw new Error("Instagram-сессия больше не авторизована.");
  }

  // ----------------------------------------------------------
  // Получаем реальные числа
  // ----------------------------------------------------------

  const followersText = await page
    .locator("a")
    .filter({
      hasText: /подписчик/i,
    })
    .first()
    .innerText();

  const followingText = await page
    .locator("a")
    .filter({
      hasText: /подписок/i,
    })
    .first()
    .innerText();

  const followersCount = Number(
    followersText.replace(/\s/g, "").match(/\d+/)?.[0],
  );

  const followingCount = Number(
    followingText.replace(/\s/g, "").match(/\d+/)?.[0],
  );

  console.log(`Followers в профиле: ${followersCount}`);

  console.log(`Following в профиле: ${followingCount}`);

  // ==========================================================
  // FOLLOWERS
  // ==========================================================

  console.log("\n============================");
  console.log("FOLLOWERS");
  console.log("============================");

  await openFollowList(page, "followers");

  const followers = await collectUsers(page, "followers", followersCount);

  console.log(`\n✓ Собрано followers: ${followers.length}`);

  fs.writeFileSync(FOLLOWERS_FILE, JSON.stringify(followers, null, 2));

  await closeFollowList(page);

  // ==========================================================
  // FOLLOWING
  // ==========================================================

  console.log("\n============================");
  console.log("FOLLOWING");
  console.log("============================");

  await openFollowList(page, "following");

  const following = await collectUsers(page, "following", followingCount);

  console.log(`\n✓ Собрано following: ${following.length}`);

  fs.writeFileSync(FOLLOWING_FILE, JSON.stringify(following, null, 2));

  // ==========================================================
  // СРАВНЕНИЕ
  // ==========================================================

  console.log("\n============================");
  console.log("СРАВНЕНИЕ");
  console.log("============================");

  const followersSet = new Set(
    followers.map((user) => user.username.toLowerCase()),
  );

  const notFollowingBack = following.filter(
    (user) => !followersSet.has(user.username.toLowerCase()),
  );

  // ==========================================================
  // RESULT
  // ==========================================================

  const result = {
    account: USERNAME,

    stats: {
      followersProfile: followersCount,
      followersCollected: followers.length,

      followingProfile: followingCount,
      followingCollected: following.length,

      notFollowingBack: notFollowingBack.length,
    },

    users: notFollowingBack,
  };

  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));

  console.log("\n============================");
  console.log("RESULT");
  console.log("============================");

  console.log(`Followers: ${followers.length}/${followersCount}`);

  console.log(`Following: ${following.length}/${followingCount}`);

  console.log(`Не подписаны на тебя: ${notFollowingBack.length}`);

  console.log("\nНе подписаны в ответ:\n");

  notFollowingBack.forEach((user, index) => {
    console.log(`${index + 1}. @${user.username}`);

    console.log(`   ${user.url}`);
  });

  console.log(`\n✓ Followers → ${FOLLOWERS_FILE}`);

  console.log(`✓ Following → ${FOLLOWING_FILE}`);

  console.log(`✓ Результат → ${RESULT_FILE}`);

  // ----------------------------------------------------------
  // Обновляем session
  // ----------------------------------------------------------

  await context.storageState({
    path: SESSION_FILE,
  });

  await browser.close();
}

// ============================================================

main().catch((error) => {
  console.error("\n❌ Ошибка:");
  console.error(error);

  process.exit(1);
});
