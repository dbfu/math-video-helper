import { exec, ExecException } from 'child_process';
import { existsSync, promises as fs, mkdirSync } from 'fs';
import os from 'os';
import path, { join } from 'path';
import { WorkflowState } from './types.js';

// 模板项目目录（只创建一次，安装依赖后保留）
const templateProjectDir = path.join(os.tmpdir(), 'remotion-project-template');

// 缓存 chrome 路径
let chromePath: string | null = null;

// 获取平台对应的 chrome-headless-shell zip 文件名
function getChromeZipName(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return 'chrome-headless-shell-win64.zip';
  }
  if (platform === 'darwin') {
    return 'chrome-headless-shell-mac-arm64.zip';
  }
  // Linux
  return 'chrome-headless-shell-linux64.zip';
}

// 查找本地 chrome-headless-shell zip 文件并解压
async function extractLocalChrome(projectDir: string): Promise<string | null> {
  // Docker 中在 /app/server，本地在 process.cwd()
  const isDocker = existsSync('/app/server');
  const serverDir = isDocker ? '/app/server' : process.cwd();
  const zipName = getChromeZipName();
  const zipPath = path.join(serverDir, zipName);

  if (existsSync(zipPath)) {
    console.log(`📦 发现本地 chrome: ${zipPath}`);
    const chromeDir = path.join(projectDir, path.basename(zipName, '.zip'));

    // 如果已经解压过，直接返回
    if (existsSync(chromeDir)) {
      return chromeDir;
    }

    // 使用系统 unzip 解压（避免 adm-zip 的文件名编码问题）
    await new Promise<void>((resolve, reject) => {
      exec(
        `unzip -o "${zipPath}" -d "${projectDir}"`,
        (error, _stdout, stderr) => {
          if (error) {
            console.error('解压 chrome 错误:', stderr);
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    console.log(`✅ 解压本地 chrome 到: ${chromeDir}`);
    return chromeDir;
  }

  return null;
}

// 根据平台获取 Chrome 目录名
function getChromeDirName(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return 'chrome-headless-shell-win64';
  }
  if (platform === 'darwin') {
    return 'chrome-headless-shell-mac-arm64';
  }
  // Linux (包括 Docker)
  return 'chrome-headless-shell-linux64';
}

// 查找 chrome-headless-shell 路径
async function findChromePath(projectDir: string): Promise<string | null> {
  const chromeDirName = getChromeDirName();
  const chromeDir = path.join(projectDir, chromeDirName);
  const chromeBin = path.join(
    chromeDir,
    process.platform === 'win32'
      ? 'chrome-headless-shell.exe'
      : 'chrome-headless-shell',
  );

  if (existsSync(chromeBin)) {
    console.log('在项目里发现 chrome-headless-shell:', chromeBin);
    return chromeBin;
  }

  // Docker/Remotion 环境中查找 remotion 安装的浏览器
  if (process.platform === 'linux') {
    // 1. 查找 Docker 构建时安装的浏览器 (/app/server)
    const dockerCacheDir = path.join(
      '/app/server',
      'node_modules',
      '.cache',
      'remotion',
      'browser',
    );
    if (existsSync(dockerCacheDir)) {
      const linuxChromeDir = path.join(dockerCacheDir, 'linux');
      if (existsSync(linuxChromeDir)) {
        const linuxChrome = path.join(linuxChromeDir, 'chrome-headless-shell');
        if (existsSync(linuxChrome)) {
          return linuxChrome;
        }
      }
    }

    // 2. remotion 会把浏览器安装到项目目录的 node_modules/.cache/remotion/browser
    const remotionCacheDir = path.join(
      projectDir,
      'node_modules',
      '.cache',
      'remotion',
      'browser',
    );
    if (existsSync(remotionCacheDir)) {
      // 查找 linux 目录
      const linuxChromeDir = path.join(remotionCacheDir, 'linux');
      if (existsSync(linuxChromeDir)) {
        const linuxChrome = path.join(linuxChromeDir, 'chrome-headless-shell');
        if (existsSync(linuxChrome)) {
          return linuxChrome;
        }
      }
    }

    // 3. 尝试常见的系统 chromium 路径
    const linuxChromiumPaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ];
    for (const p of linuxChromiumPaths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  return null;
}

// 获取或创建 remotion 项目目录
async function getRemotionProjectDir(): Promise<{
  projectDir: string;
  chromePath: string | null;
}> {
  // 使用时间戳+随机数确保并发时不冲突
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const projectDir = path.join(os.tmpdir(), `remotion-project-${uniqueId}`);

  // 如果模板目录已存在且有 node_modules，说明已经初始化过
  if (
    existsSync(templateProjectDir) &&
    existsSync(path.join(templateProjectDir, 'node_modules'))
  ) {
    console.log('✅ 从模板复制项目...');
    // 从模板复制项目（不包括 out 目录）
    await copyProjectTemplate(projectDir);

    // 查找 chrome 路径（优先使用缓存，其次从模板目录查找，最后尝试解压本地 chrome）
    if (!chromePath) {
      chromePath = await findChromePath(templateProjectDir);
      if (!chromePath) {
        // 尝试从本地解压 chrome
        const localChromeDir = await extractLocalChrome(templateProjectDir);
        if (localChromeDir) {
          const localChromeBin = path.join(
            localChromeDir,
            process.platform === 'win32'
              ? 'chrome-headless-shell.exe'
              : 'chrome-headless-shell',
          );
          if (existsSync(localChromeBin)) {
            chromePath = localChromeBin;
            console.log('✅ 使用本地 chrome-headless-shell:', chromePath);
          }
        }
      }
      if (chromePath) {
        console.log('✅ 找到 chrome-headless-shell:', chromePath);
      }
    }

    return {projectDir, chromePath};
  }

  console.log('📦 初始化 Remotion 项目模板...');

  // 确保临时目录存在
  if (!existsSync(os.tmpdir())) {
    mkdirSync(os.tmpdir(), {recursive: true});
  }

  // 如果模板目录已存在，先删除
  if (existsSync(templateProjectDir)) {
    await fs.rm(templateProjectDir, {recursive: true, force: true});
  }

  // 获取压缩包路径（Docker 中在 /app/server，本地在 server 目录）
  // 检查 /app/server 目录是否存在来判断是否在 Docker 中
  const isDocker = existsSync('/app/server');
  const sourceDir = isDocker ? '/app/server' : path.join(process.cwd());

  // 解压 remotion-project.zip 到模板目录
  const zipPath = path.join(sourceDir, 'remotion-project.zip');

  // 先解压到一个临时目录
  const tempUnzipDir = path.join(os.tmpdir(), 'remotion-unzip-temp');
  await fs.rm(tempUnzipDir, {recursive: true, force: true});
  await unzip(zipPath, tempUnzipDir);

  // zip 包内有一个 remotion-project 文件夹，需要把内容移到 templateProjectDir
  const innerProjectDir = path.join(tempUnzipDir, 'remotion-project');

  if (existsSync(innerProjectDir)) {
    // 将 innerProjectDir 的内容复制到 templateProjectDir
    await new Promise<void>((resolve, reject) => {
      exec(`cp -R "${innerProjectDir}/." "${templateProjectDir}"`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    // 清理临时解压目录
    await fs.rm(tempUnzipDir, {recursive: true, force: true});
  } else {
    // 如果没有内层文件夹，直接解压到目标目录（向后兼容）
    await fs.rename(tempUnzipDir, templateProjectDir);
  }

  // 尝试从本地解压 chrome（优先使用本地 chrome）
  const localChromeDir = await extractLocalChrome(templateProjectDir);
  if (localChromeDir) {
    // 从本地解压的 chrome 目录查找 chrome 路径
    const localChromeBin = path.join(
      localChromeDir,
      process.platform === 'win32'
        ? 'chrome-headless-shell.exe'
        : 'chrome-headless-shell',
    );
    if (existsSync(localChromeBin)) {
      chromePath = localChromeBin;
      console.log('✅ 使用本地 chrome-headless-shell:', chromePath);
    }
  }

  // 安装依赖
  console.log('📥 安装 Remotion 项目依赖...');
  await new Promise<void>((resolve, reject) => {
    exec(
      'npm install',
      {cwd: templateProjectDir},
      (error: ExecException | null, _stdout: string, stderr: string) => {
        if (error) {
          console.error('npm install 错误:', stderr);
          reject(error);
          return;
        }
        console.log('✅ 依赖安装完成');
        resolve();
      },
    );
  });

  // 查找 chrome 路径
  chromePath = await findChromePath(templateProjectDir);
  if (chromePath) {
    console.log('✅ 找到 chrome-headless-shell:', chromePath);
  }

  // 第一次也需要复制一份到工作目录
  await copyProjectTemplate(projectDir);
  return {projectDir, chromePath};
}

// 从模板复制项目到工作目录
async function copyProjectTemplate(destDir: string): Promise<void> {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windows: 使用 xcopy 或 robocopy
    await new Promise<void>((resolve, reject) => {
      exec(
        `xcopy /E /I /Y "${templateProjectDir}" "${destDir}"`,
        {cwd: os.tmpdir()},
        (error, stdout, stderr) => {
          if (error) {
            console.error('复制项目错误:', stderr);
            reject(error);
            return;
          }
          // 删除 out 目录和 node_modules，然后创建 junction
          exec(
            `rmdir /S /Q "${destDir}\\out" 2>nul & rmdir /S /Q "${destDir}\\node_modules" & mklink /J "${destDir}\\node_modules" "${templateProjectDir}\\node_modules"`,
            (linkError) => {
              if (linkError) {
                console.error('创建符号链接错误:', linkError);
                // 符号链接失败时，直接复制 node_modules
                exec(
                  `xcopy /E /I /Y "${templateProjectDir}\\node_modules" "${destDir}\\node_modules"`,
                  (copyError) => {
                    if (copyError) {
                      console.error('复制 node_modules 错误:', copyError);
                      reject(copyError);
                      return;
                    }
                    resolve();
                  },
                );
                return;
              }
              resolve();
            },
          );
        },
      );
    });
  } else {
    // macOS/Linux: 使用 cp -R 复制，然后删除 out 目录，node_modules 使用符号链接
    await new Promise<void>((resolve, reject) => {
      exec(
        `cp -R "${templateProjectDir}/." "${destDir}" && rm -rf "${destDir}/out"/* && rm -rf "${destDir}/node_modules" && ln -s "${templateProjectDir}/node_modules" "${destDir}/node_modules"`,
        {cwd: os.tmpdir()},
        (error, stdout, stderr) => {
          if (error) {
            console.error('复制项目错误:', stderr);
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  }
}

// 解压 zip 文件（使用系统 unzip 命令，避免 adm-zip 的文件名编码问题）
async function unzip(zipPath: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${destDir}"`, (error, _stdout, stderr) => {
      if (error) {
        console.error('解压错误:', stderr);
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function renderVideo(
  storyboard: WorkflowState['storyboard'],
  videoCode: string,
): Promise<string> {
  // 获取或创建 remotion 项目目录
  const {projectDir, chromePath} = await getRemotionProjectDir();
  const srcDir = path.join(projectDir, 'src');
  const audioDir = path.join(srcDir, 'audio');
  const outDir = path.join(projectDir, 'out');
  const demoProjectDir = process.cwd();
  const publicDir = path.join(demoProjectDir, 'public/video');

  // 确保 public 目录存在（如果不存在则创建）
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, {recursive: true});
    console.log('✅ 创建 public 目录');
  }

  try {
    const totalDuration = storyboard.reduce(
      (sum, step) => sum + Math.ceil(step.duration || 0),
      0,
    );
    console.log(`   视频总时长：${totalDuration}秒`);

    const code = videoCode.match(/```jsx\s*([\s\S]*?)\s*```/);

    await fs.writeFile(
      path.join(srcDir, 'Component.tsx'),
      code?.[1] || videoCode,
    );

    await fs.writeFile(
      path.join(srcDir, 'Root.tsx'),
      `
import { Composition } from "remotion";
import Component from "./Component";
import "./index.css";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="RemotionVideo"
        component={Component}
        durationInFrames={${totalDuration} * 30}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
`,
    );

    // 确保 audioDir 存在
    if (!existsSync(audioDir)) {
      mkdirSync(audioDir, {recursive: true});
    }

    const files = await fs.readdir(audioDir);
    await Promise.all(
      files.map((file) => {
        if (file.endsWith('.mp3')) {
          return fs.unlink(join(audioDir, file));
        }
        return Promise.resolve();
      }),
    );

    // 确保源 audio 文件夹存在
    const sourceAudioDir = path.join(demoProjectDir, 'audio');
    if (existsSync(sourceAudioDir)) {
      await Promise.all(
        storyboard.map((_step, index) =>
          fs
            .readFile(path.join(sourceAudioDir, `step_${index + 1}.mp3`))
            .then((data) =>
              fs.writeFile(path.join(audioDir, `step_${index + 1}.mp3`), data),
            ),
        ),
      );
    }

    const videoName = `math_problem_${Date.now()}.mp4`;

    let stdoutOutput = '';
    let stderrOutput = '';

    // 构建 remotion render 命令
    let renderCmd = `npx remotion render src/index.ts RemotionVideo out/${videoName}`;

    // 使用局部变量存储浏览器路径
    let browserPath = chromePath;

    // 如果 chromePath 为空，尝试从 projectDir 查找
    if (!browserPath) {
      browserPath = await findChromePath(projectDir);
    }

    // 如果仍然找不到，复制本地解压的 chrome 到 projectDir
    if (!browserPath && chromePath) {
      const chromeDir = path.dirname(chromePath);
      const destChromeDir = path.join(projectDir, path.basename(chromeDir));
      try {
        await fs.cp(chromeDir, destChromeDir, {recursive: true});
        browserPath = path.join(destChromeDir, path.basename(chromePath));
        console.log('✅ 复制本地 chrome 到工作目录:', browserPath);
      } catch (e) {
        console.error('复制 chrome 失败:', e);
      }
    }

    // 如果没有找到浏览器，先下载
    if (!browserPath) {
      console.log('📥 正在下载 Remotion 浏览器...');
      await new Promise<void>((resolve) => {
        exec('npx remotion browser ensure', {cwd: projectDir}, (error) => {
          if (error) {
            console.error('下载浏览器错误:', error.message);
          } else {
            console.log('✅ 浏览器下载完成');
          }
          resolve();
        });
      });
      // 再次查找浏览器路径
      browserPath = await findChromePath(projectDir);
    }

    if (browserPath) {
      // 添加执行权限
      if (process.platform !== 'win32') {
        try {
          await new Promise<void>((resolve) => {
            exec(`chmod +x "${browserPath}"`, () => resolve());
          });
        } catch {}
      }
      renderCmd += ` --browser-executable="${browserPath}"`;
      console.log(`   使用 chrome: ${browserPath}`);
    }

    await new Promise<void>((resolve, reject) => {
      const childProcess = exec(
        renderCmd,
        {cwd: projectDir},
        (error, stdout, stderr) => {
          stdoutOutput = stdout;
          stderrOutput = stderr;

          if (error) {
            console.error(`渲染错误: ${error}`);
            reject(error);
            return;
          }
          console.log(`stdout: ${stdout}`);

          const isWindows = process.platform === 'win32';
          const srcPath = path.join(outDir, videoName);
          const destPath = path.join(publicDir, videoName);

          const copyCmd = isWindows
            ? `copy /Y "${srcPath}" "${destPath}"`
            : `cp "${srcPath}" "${destPath}"`;

          exec(copyCmd, (copyError) => {
            if (copyError) {
              console.error(`复制错误: ${copyError}`);
              reject(copyError);
              return;
            }
            console.log('✅ [Node] 视频渲染完成');
            resolve();
          });
        },
      );

      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        stdoutOutput += text;
        console.log(text);
      });

      childProcess.stderr?.on('data', (data) => {
        stderrOutput += data.toString();
      });
    });

    const combinedOutput = stdoutOutput + stderrOutput;
    if (
      combinedOutput.includes('An error occurred') ||
      combinedOutput.includes('Error:')
    ) {
      const errorMatch = combinedOutput.match(
        /An error occurred[\s\S]*?(?=\n\n|\n$|$)/,
      );
      const errorMessage = errorMatch ? errorMatch[0] : combinedOutput;
      throw new Error(errorMessage);
    }

    return videoName;
  } finally {
    // 无论成功还是失败都清理临时项目目录
    console.log('🧹 清理临时项目目录...');
    // await fs.rm(projectDir, {recursive: true, force: true});
  }
}

export async function renderVideoNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  console.log('🎬 [Node] 渲染视频...');

  config?.writer({
    type: 'message',
    content: '渲染视频',
  });

  try {
    const videoName = await renderVideo(state.storyboard, state.videoCode);
    config?.writer({
      type: 'success',
      videoUrl: `/video/${videoName}`,
    });
    return {
      videoUrl: `/video/${videoName}`,
      retryCount: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [Node] 渲染失败: ${errorMessage}`);
    const retryCount = (state.retryCount || 0) + 1;
    return {
      retryCount,
    };
  }
}
