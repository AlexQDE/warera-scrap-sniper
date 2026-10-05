// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { ownUserId } from "./dom.mjs";

// The logged-in page of 2026-10-05: the header links the player's own inventory
// and skills; chat and ranking links point at other players' bare profiles.
const ME = "697b55e4bcecf3b37667e0d1";
const OTHER = "695d4d819bd9761af754f28f";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ownUserId", () => {
  it("reads the player's id off the own-profile links and ignores other players' links", () => {
    document.body.innerHTML = `<nav><a href="/user/${ME}/skills">Skills</a><a href="/user/${ME}/inventory">Inventory</a></nav><div class="chat"><a href="/user/${OTHER}">someone</a><a href="/user/${ME}">me in chat</a></div>`;
    expect(ownUserId()).toBe(ME);
  });
  it("gives nothing without such links, or with two different ids", () => {
    document.body.innerHTML = `<div><a href="/user/${OTHER}">someone</a><a href="/battle/6ac36583348bbdc177cb3d6e">battle</a></div>`;
    expect(ownUserId()).toBeNull();
    document.body.innerHTML = `<a href="/user/${ME}/inventory">a</a><a href="/user/${OTHER}/skills">b</a>`;
    expect(ownUserId()).toBeNull();
    document.body.innerHTML = `<a href="/user/not-an-id/inventory">a</a><a href="https://evil.example/user/${ME}/inventory">b</a>`;
    expect(ownUserId()).toBeNull();
  });
});
