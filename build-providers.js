import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const providersDir = path.join(__dirname, "_providers");

console.log("📦 Setting up Vega Providers...\n");

// Check if _providers exists
if (!fs.existsSync(providersDir)) {
  console.log("Cloning vega-providers...");
  execSync(
    "git clone --depth 1 https://github.com/Zenda-Cross/vega-providers.git _providers",
    { cwd: __dirname, stdio: "inherit" }
  );
} else {
  console.log("Pulling latest changes...");
  execSync("git pull", { cwd: providersDir, stdio: "inherit" });
}

console.log("\nInstalling dependencies...");
execSync("npm install", { cwd: providersDir, stdio: "inherit" });

console.log("\nBuilding providers...");
execSync("npm run build", { cwd: providersDir, stdio: "inherit" });

console.log("\n✅ Setup complete! Run: npm start");
