import { createInterface } from "node:readline";

/** Asks for a password without showing it as it is typed. */
export function askPassword(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    // Once the question is on screen, swallow the echo of every keystroke.
    rl._writeToOutput = () => {};
  });
}
