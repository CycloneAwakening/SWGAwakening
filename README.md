# Sentinels Republic Launcher

**Electron application based on [dpwhitter's RoC Launcher](https://github.com/dpwhittaker/RoC-Launcher) and [Tyclo's Adaptation](https://github.com/DesporoWace/SR-Launcher) **

**All graphics are property of SWG Awakening or The Respective Authors**

## Features

The SWG Awakening Launcher includes a new user friendly interface, a guided set up process, patching for multiple login servers and Linux/macOS compatibility. Also included are many other miscellaneous tweaks, improvements and new features.

## Get Started

To clone and run this repository you'll need [Git](https://git-scm.com) and [Node.js](https://nodejs.org/en/download/) (which comes with [npm](http://npmjs.com)) installed on your computer. From your command line:

```bash
# Clone this repository
git clone https://github.com/CycloneAwakening/Testing-Launcher-Editing.git
# Go into the repository
cd SR-Launcher
# Install dependencies
npm install
# Run the app
npm start
```

Note: If you're using Linux Bash for Windows, [see this guide](https://www.howtogeek.com/261575/how-to-run-graphical-linux-desktop-applications-from-windows-10s-bash-shell/) or use `node` from the command prompt.

## Building

Commands for building can be found in `package.json` under `scripts`. Argument of `-p always` will publish the build as a release to your repository.

### Windows - Public Release
- Create a [Personal Access Token](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
- In Windows, set an Environmental variable in PowerShell with the following command, replacing "YOUR_TOKEN" with the token you generated above: `[Environment]::SetEnvironmentVariable("GH_TOKEN","YOUR_TOKEN","User")` - You may need to restart after running this.
- `npm pack` - Pack the applications
- `npm run-script build-win` - Build applications and publish draft to release of your applications repo.

### Windows - Local Build
- In `package.json` - Change `"build-win": "build --win --ia32 -p always",` to `"build-win": "build --win --ia32",`
- `npm pack` - Pack the applications
- `npm run-script build-win` - Build applications and publish draft to release of your applications repo.
- Inside of the `/dist` directory should an executable with your application.

### Linux / macOS - Local Build
- `npm pack` - Pack the applications
- **Linux:** `npm run-script build-linux` - Build applications and publish draft to release of your applications repo.
- **macOS:** `npm run-script build-mac` - Build applications and publish draft to release of your applications repo.
- Inside of the `/dist` directory should a package containing your application. Some limitations apply when packaging on a platform that cannot execute the package. (You can only make a macOS .dmg on macOS)

# About

## Structure

- `package.json` - Points to the app's main file and lists its details and dependencies.
- `main.js` - Starts the app and creates a browser window to render HTML. This is the app's **main process**.
- `index.html` - A web page to render. This is the app's **renderer process**.
- `renderer.js` - Handles users interaction with the application.
- `install.js` - Handles the patching process.
- `md5.js` - Checks md5 of files for patching.
- `/setup` - Directory containing files for guided setup process.

# Resources for Learning Electron

- [electron.atom.io/docs](http://electron.atom.io/docs) - all of Electron's documentation
- [electron.atom.io/community/#boilerplates](http://electron.atom.io/community/#boilerplates) - sample starter apps created by the community
- [electron/electron-quick-start](https://github.com/electron/electron-quick-start) - a very basic starter Electron app
- [electron/simple-samples](https://github.com/electron/simple-samples) - small applications with ideas for taking them further
- [electron/electron-api-demos](https://github.com/electron/electron-api-demos) - an Electron app that teaches you how to use Electron
- [hokein/electron-sample-apps](https://github.com/hokein/electron-sample-apps) - small demo apps for the various Electron APIs

## License

[CC0 1.0 (Public Domain)](LICENSE.md)
