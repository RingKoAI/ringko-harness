import { expect, it } from "bun:test";
import { filterItems } from "../src/selection.ts";
import { remoteSessionItems } from "../src/session-picker.ts";

it("marks busy sessions in the resume list while keeping idle rows plain", () => {
  const items = remoteSessionItems([
    { id: "busy", createdAt: 1, cwd: "/work", title: "Busy task", summary: "working", busy: true },
    { id: "idle", createdAt: 2, cwd: "/work", title: "Idle task", summary: "done", busy: false },
  ]);
  expect(items[0]).toMatchObject({ value: "busy", label: "[*] Busy task", description: "running · working" });
  expect(items[1]).toMatchObject({ value: "idle", label: "Idle task", description: "done" });
  expect(filterItems(items, "running").map(item => item.value)).toEqual(["busy"]);
});
