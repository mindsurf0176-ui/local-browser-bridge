#!/usr/bin/env node
import { runMcpStdioServer } from "./mcp";

function main(): void {
  runMcpStdioServer();
}

if (require.main === module) {
  main();
}
