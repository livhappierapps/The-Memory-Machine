const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Stop Metro from walking up the Replit monorepo and grabbing a second React.
config.resolver.disableHierarchicalLookup = true;

const reactDir = path.resolve(workspaceRoot, "node_modules/react");
const reactNativeDir = path.resolve(workspaceRoot, "node_modules/react-native");

config.resolver.extraNodeModules = {
  react: reactDir,
  "react-dom": path.resolve(workspaceRoot, "node_modules/react-dom"),
  "react-native": reactNativeDir,
};

module.exports = config;
