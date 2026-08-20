import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicPages = ["index.html", "login.html"];

const readPngDimensions = async (path) => {
  const png = await readFile(new URL(path, import.meta.url));

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${path} should be a PNG`,
  );

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
};

test("public pages declare the Job Scout favicon", async () => {
  for (const page of publicPages) {
    const html = await readFile(new URL(`./${page}`, import.meta.url), "utf8");

    assert.match(html, /rel="icon"[^>]+href="\.\/assets\/favicon-32\.png"/);
    assert.match(html, /rel="apple-touch-icon"[^>]+href="\.\/assets\/apple-touch-icon\.png"/);
  }
});

test("favicon assets use their declared square dimensions", async () => {
  assert.deepEqual(await readPngDimensions("./assets/favicon-32.png"), {
    width: 32,
    height: 32,
  });
  assert.deepEqual(await readPngDimensions("./assets/apple-touch-icon.png"), {
    width: 180,
    height: 180,
  });
});
