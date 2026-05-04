import { createOpenSCAD } from "openscad-wasm-prebuilt";

let runtimePromise = null;
let boslMounted = false;
let currentLog = [];

function ensureDir(fs, dirPath) {
  const parts = dirPath.split("/").filter(Boolean);
  let current = "";
  parts.forEach((part) => {
    current += `/${part}`;
    try {
      fs.mkdir(current);
    } catch (error) {
      if (error?.errno !== 20) {
        // EEXIST in Emscripten FS is errno 20.
      }
    }
  });
}

function writeFile(fs, filePath, content) {
  const parent = filePath.split("/").slice(0, -1).join("/");
  if (parent) {
    ensureDir(fs, parent);
  }
  try {
    fs.unlink(filePath);
  } catch {
    // Missing files are fine; each render rewrites its workspace.
  }
  fs.writeFile(filePath, content);
}

async function mountBosl(instance, assetBaseUrl) {
  if (boslMounted) {
    return;
  }

  const base = new URL("vendor/BOSL2/", assetBaseUrl);
  const filesResponse = await fetch(new URL("files.json", base));
  if (!filesResponse.ok) {
    throw new Error(`Could not load BOSL2 file manifest (${filesResponse.status}).`);
  }
  const files = await filesResponse.json();
  ensureDir(instance.FS, "/BOSL2");

  await Promise.all(files.map(async (relativePath) => {
    const response = await fetch(new URL(relativePath, base));
    if (!response.ok) {
      throw new Error(`Could not load BOSL2/${relativePath} (${response.status}).`);
    }
    writeFile(instance.FS, `/BOSL2/${relativePath}`, await response.text());
  }));

  boslMounted = true;
}

async function getRuntime(assetBaseUrl) {
  if (!runtimePromise) {
    runtimePromise = createOpenSCAD({
      noInitialRun: true,
      print: (text) => currentLog.push(text),
      printErr: (text) => currentLog.push(text)
    }).then(async (openscad) => {
      const instance = openscad.getInstance();
      await mountBosl(instance, assetBaseUrl);
      return instance;
    });
  }
  return runtimePromise;
}

async function render({ source, assetBaseUrl }) {
  currentLog = [];
  const instance = await getRuntime(assetBaseUrl);

  writeFile(instance.FS, "/input.scad", source);
  try {
    instance.FS.unlink("/output.stl");
  } catch {
    // Missing output from a previous run is fine.
  }

  const exitCode = instance.callMain(["/input.scad", "-o", "/output.stl"]);
  if (exitCode && exitCode !== 0) {
    throw new Error(`OpenSCAD exited with code ${exitCode}.`);
  }

  const output = instance.FS.readFile("/output.stl");
  const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  return { buffer, log: currentLog.join("\n") };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type !== "render") {
    return;
  }

  try {
    const result = await render(message);
    self.postMessage(
      { type: "rendered", requestId: message.requestId, buffer: result.buffer, log: result.log },
      [result.buffer]
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
      log: currentLog.join("\n")
    });
  }
};
