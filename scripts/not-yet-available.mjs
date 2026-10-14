process.stderr.write(`NOT RUN: ${process.argv[2]} suite requires Phase 2 API and an isolated test DB.\n`);
process.exitCode = 1;
