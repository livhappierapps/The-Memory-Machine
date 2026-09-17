const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

function resolvePkg(name) {
  try {
    return path.dirname(
      require.resolve(`${name}/package.json`, {
        paths: [projectRoot, workspaceRoot],
      }),
    );
  } catch {
    return path.resolve(workspaceRoot, "node_modules", name);
  }
}

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;

// One physical React for the whole bundle. Dual copies make useId dispatcher null in Expo Go.
config.resolver.extraNodeModules = {
  react: resolvePkg("react"),
  "react-dom": resolvePkg("react-dom"),
  "react-native": resolvePkg("react-native"),
};

module.exports = config;
