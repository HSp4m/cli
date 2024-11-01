import { input, select } from "@inquirer/prompts"
import fs from "fs"
import { spawn } from "child_process"
import path from "path"
import { fileURLToPath } from "url"
import fetch from "node-fetch"
import chalk from "chalk"
import { getPackageManager } from "@/utils/get-package-manager"
import ora from "ora"
import { getClassesTsRepoUrl, getRepoUrlForComponent } from "@/utils/repo"
import open from "open"
import { theme } from "@/commands/theme"
import {
  capitalize,
  hasFolder,
  isLaravel,
  isNextJs,
  isRemix,
  possibilityComponentsPath,
  possibilityCssPath,
  possibilityUtilsPath,
} from "@/utils/helpers"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const resourceDir = path.resolve(__dirname, "../src/resources")
const stubs = path.resolve(__dirname, "../src/resources/stubs")

export async function init() {
  const configJsExists = fs.existsSync("tailwind.config.js")
  const configTsExists = fs.existsSync("tailwind.config.ts")

  if (!configJsExists && !configTsExists) {
    console.error("No Tailwind configuration file found. Please ensure tailwind.config.ts or tailwind.config.js exists in the root directory.")
    return
  }

  let componentFolder, uiFolder, cssLocation, configSourcePath, themeProvider, providers, utilsFolder

  componentFolder = await input({
    message: "Enter the path to your components folder:",
    default: possibilityComponentsPath(),
  })

  uiFolder = path.join(componentFolder, "ui")

  utilsFolder = await input({
    message: "Enter the path to your utils folder:",
    default: possibilityUtilsPath(),
  })

  cssLocation = await input({
    message: "Where would you like to place the CSS file?",
    default: possibilityCssPath(),
  })

  if (isNextJs() && hasFolder("src")) {
    configSourcePath = path.join(stubs, "next/tailwind.config.src.next.stub")
    themeProvider = path.join(stubs, "next/theme-provider.stub")
    providers = path.join(stubs, "next/providers.stub")
  } else if (isNextJs() && !hasFolder("src")) {
    configSourcePath = path.join(stubs, "next/tailwind.config.next.stub")
    themeProvider = path.join(stubs, "next/theme-provider.stub")
    providers = path.join(stubs, "next/providers.stub")
  } else if (isLaravel()) {
    configSourcePath = path.join(stubs, "laravel/tailwind.config.laravel.stub")
    themeProvider = path.join(stubs, "laravel/theme-provider.stub")
    providers = path.join(stubs, "laravel/providers.stub")
  } else if (isRemix()) {
    configSourcePath = path.join(stubs, "next/tailwind.config.next.stub")
    themeProvider = path.join(stubs, "next/theme-provider.stub")
    providers = path.join(stubs, "next/providers.stub")
  } else {
    configSourcePath = path.join(stubs, "next/tailwind.config.src.next.stub")
    themeProvider = path.join(stubs, "next/theme-provider.stub")
    providers = path.join(stubs, "next/providers.stub")
  }

  if (!fs.existsSync(utilsFolder)) {
    fs.mkdirSync(utilsFolder, { recursive: true })
  }

  if (!fs.existsSync(uiFolder)) {
    fs.mkdirSync(uiFolder, { recursive: true })
  }

  const selectedTheme = await theme(cssLocation)

  const tailwindConfigTarget = fs.existsSync("tailwind.config.js") ? "tailwind.config.js" : "tailwind.config.ts"

  const spinner = ora(`Initializing Justd...`).start()
  if (!fs.existsSync(configSourcePath)) {
    spinner.warn(chalk.yellow(`Source Tailwind config file does not exist at ${configSourcePath}`))
    return
  }

  try {
    const tailwindConfigContent = fs.readFileSync(configSourcePath, "utf8")
    fs.writeFileSync(tailwindConfigTarget, tailwindConfigContent, { flag: "w" })
  } catch (error) {
    // @ts-ignore
    spinner.fail(`Failed to write Tailwind config to ${tailwindConfigTarget}: ${error.message}`)
  }

  const packageManager = await getPackageManager()

  let mainPackages = ["react-aria-components", "justd-icons"].join(" ")

  let devPackages = ["tailwindcss-react-aria-components", "tailwind-variants", "tailwind-merge", "clsx", "tailwindcss-animate"].join(" ")

  if (isNextJs()) {
    devPackages += " next-themes"
  }
  if (isRemix()) {
    devPackages += " remix-themes"
  }

  const action = packageManager === "npm" ? "i " : "add "
  const installCommand = `${packageManager} ${action}${mainPackages} && ${packageManager} ${action} -D ${devPackages}`

  spinner.info(`Installing dependencies...`)

  const child = spawn(installCommand, {
    stdio: "inherit",
    shell: true,
  })

  await new Promise<void>((resolve) => {
    child.on("close", () => {
      resolve()
    })
  })

  const fileUrl = getRepoUrlForComponent("primitive")
  const response = await fetch(fileUrl)

  if (!response.ok) throw new Error(`Failed to fetch component: ${response.statusText}`)

  let fileContent = await response.text()

  if (isLaravel()) {
    fileContent = fileContent.replace(/['"]use client['"]\s*\n?/g, "")
  }

  fs.writeFileSync(path.join(uiFolder, "primitive.tsx"), fileContent, { flag: "w" })
  fs.writeFileSync(path.join(uiFolder, "index.ts"), `export * from './primitive';`, { flag: "w" })

  const responseClasses = await fetch(getClassesTsRepoUrl())
  const fileContentClasses = await responseClasses.text()
  fs.writeFileSync(path.join(utilsFolder, "classes.ts"), fileContentClasses, { flag: "w" })

  if (themeProvider) {
    const themeProviderContent = fs.readFileSync(themeProvider, "utf8")
    fs.writeFileSync(path.join(componentFolder, "theme-provider.tsx"), themeProviderContent, { flag: "w" })

    if (providers) {
      const providersContent = fs.readFileSync(providers, "utf8")
      fs.writeFileSync(path.join(componentFolder, "providers.tsx"), providersContent, { flag: "w" })
    }
  }

  const tsConfigPath = path.join(process.cwd(), "tsconfig.json")

  if (fs.existsSync(tsConfigPath)) {
    let tsConfig

    try {
      const tsConfigContent = fs.readFileSync(tsConfigPath, "utf8")
      tsConfig = JSON.parse(tsConfigContent)
    } catch (error) {
      // @ts-ignore
      console.error("JSON parsing error:", error.message)
      return
    }

    if (!tsConfig.compilerOptions) tsConfig.compilerOptions = {}
    if (!tsConfig.compilerOptions.paths) {
      const rootPath = await input({
        message: "No paths found in tsconfig.json. Please enter the root directory path for the '@/':",
        default: "./src",
      })

      tsConfig.compilerOptions.paths = {
        "@/*": [`${rootPath}/*`],
      }

      try {
        fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2))
      } catch (error) {
        // @ts-ignore
        console.error("Error writing to tsconfig:", error.message)
      }
    }
  }

  async function getUserAlias(): Promise<string | null> {
    const tsConfigPath = path.join(process.cwd(), "tsconfig.json")
    if (fs.existsSync(tsConfigPath)) {
      const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, "utf8"))
      const paths = tsConfig.compilerOptions?.paths

      if (paths) {
        const firstAliasKey = Object.keys(paths)[0]
        return firstAliasKey.replace("/*", "")
      }
    }
    return null
  }

  const currentAlias = await getUserAlias()

  const config = {
    $schema: "https://getjustd.com",
    ui: uiFolder,
    classes: utilsFolder,
    theme: capitalize(selectedTheme?.replace(".css", "")!),
    css: cssLocation,
    alias: currentAlias,
  }

  try {
    fs.writeFileSync("justd.json", JSON.stringify(config, null, 2))
  } catch (error) {
    // @ts-ignore
    console.error("Error writing to justd.json:", error?.message)
  }

  const continuedToAddComponent = spawn("npx justd-cli@latest add", {
    stdio: "inherit",
    shell: true,
  })

  await new Promise<void>((resolve) => {
    continuedToAddComponent.on("close", () => {
      resolve()
    })
  })

  const visitRepo = await select({
    message: "Hey look! You made it this far! 🌟 How about a quick star on our GitHub repo?",
    choices: [
      { name: "Alright, take me there!", value: true },
      { name: "Maybe next time", value: false },
    ],
    default: true,
  })

  // Note After Installed------------------------------------------------------------------- //
  if (!fs.existsSync(uiFolder)) {
    fs.mkdirSync(uiFolder, { recursive: true })
    spinner.succeed(`Created UI folder at ${uiFolder}`)
  }
  spinner.succeed('Added "ui" alias to tsconfig.json')
  spinner.succeed(`primitive.tsx file copied to ${uiFolder}`)
  spinner.succeed(`classes.ts file copied to ${utilsFolder}`)
  if (themeProvider) {
    spinner.succeed(`Theme provider and providers files copied to ${componentFolder}`)
  }
  spinner.succeed("Configuration saved to justd.json")
  spinner.succeed("Installation complete.")
  // ------------------------------------------------------------------------------------- //

  if (visitRepo) {
    open("https://github.com/justdlabs/justd").then(() => {
      console.log(chalk.blueBright("-------------------------------------------"))
      console.log(" Thanks for your support! Happy coding! 🔥")
      console.log(chalk.blueBright("-------------------------------------------"))
    })
  } else {
    console.log(chalk.blueBright("------------------------------"))
    console.log("        Happy coding! 🔥")
    console.log(chalk.blueBright("------------------------------"))
  }

  spinner.stop()
}
