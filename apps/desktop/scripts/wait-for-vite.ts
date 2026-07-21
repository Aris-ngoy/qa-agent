const url = "http://localhost:5173";
const attempts = 50;
const delayMs = 200;

for (let i = 0; i < attempts; i++) {
	try {
		const response = await fetch(url);
		if (response.ok) {
			process.exit(0);
		}
	} catch {
		// Vite not ready yet
	}
	await Bun.sleep(delayMs);
}

console.error(`[qa-agent desktop] timed out waiting for Vite at ${url}`);
process.exit(1);
