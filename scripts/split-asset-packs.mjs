/**
 * Build public/assets/runtime-asset-pack.json from asset-pack.json:
 * everything except BGM (`music-game`), which loads lazily on Play.
 *
 * Keeps asset-pack.json untouched for Phaser Editor.
 * Run: node scripts/split-asset-packs.mjs
 */
import {
	existsSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "public/assets");
const sourcePath = join(assetsDir, "asset-pack.json");
const MUSIC_KEY = "music-game";

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const files = source?.section1?.files;
if (!Array.isArray(files)) {
	throw new Error("asset-pack.json missing section1.files");
}

const runtime = [];
let musicDeferred = 0;
for (const file of files) {
	if (file.type === "audio" && file.key === MUSIC_KEY) {
		musicDeferred += 1;
		continue;
	}
	runtime.push(file);
}

const pack = {
	section1: { files: runtime },
	meta: {
		app: "fisherman-fortune split-asset-packs",
		contentType: "phasereditor2d.pack.core.AssetContentType",
		version: 2,
		generatedFrom: "asset-pack.json",
		label: "runtime-no-music",
		visible: true,
	},
};

writeFileSync(
	join(assetsDir, "runtime-asset-pack.json"),
	`${JSON.stringify(pack, null, 4)}\n`,
);

for (const name of ["home-asset-pack.json", "gameplay-asset-pack.json"]) {
	const p = join(assetsDir, name);
	if (existsSync(p)) {
		unlinkSync(p);
	}
}

console.log(
	`split-asset-packs: runtime=${runtime.length} musicDeferred=${musicDeferred} (from ${files.length})`,
);
