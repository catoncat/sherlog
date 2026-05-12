import { readFileSync } from "fs";

function looksInternal(text: string): boolean {
  console.log("Checking:", JSON.stringify(text));
  return false;
}

const messageText = typeof " test " === "string" ? " test ".trim() : "";
looksInternal(messageText);
