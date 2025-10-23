import fs, { existsSync } from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { DataPackage, UpDirection } from './types/DataPackage'

const MODELS_DIR = process.env.MODELS_DIR ?? '/models'

const INPUT_EXTS = process.env.INPUT_EXTS ?? 'stl,obj'
const IGNORE = process.env.IGNORE ?? ''
const RANDOM_ORDER = booleanString(process.env.RANDOM_ORDER)

const DRY_RUN = booleanString(process.env.DRY_RUN) ?? false

const RM_STATIC = process.env.GEN_STATIC?.toLowerCase() === 'remove'
const RM_ANIM = process.env.GEN_ANIM?.toLowerCase() === 'remove'

const GEN_STATIC = (booleanString(process.env.GEN_STATIC) ?? true) && !RM_STATIC
const GEN_ANIM = (booleanString(process.env.GEN_ANIM)) && !RM_ANIM

const OVERWRITE = booleanString(process.env.OVERWRITE)

const ANIM_FPS = posIntString(process.env.ANIM_FPS) ?? 30
const ANIM_DUR = parseFloat((posFloatString(process.env.ANIM_DUR) ?? 6).toFixed(1))

const TEMP_DIR = './temp'
const F3D_CONFIG_PATH = path.join('./resources', 'f3d_config.json')

const EXT_LIST = INPUT_EXTS.split(' ')
  .join(',')
  .split(';')
  .join(',')
  .split(',')
  .filter(e => e)

const IGNORE_LIST = IGNORE.split(' ')
  .join(',')
  .split(';')
  .join(',')
  .split(',')
  .filter(i => i)

const foundFiles: string[] = []
const errorFiles: string[] = []
const collisionFiles: string[] = []
type SuccessInfo = {
  filePath: string
  duration: number // seconds generating
}
const successStaticFiles: SuccessInfo[] = []
const successAnimFiles: SuccessInfo[] = []

function booleanString(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1') {
      return true
    } else if (lower === 'false' || lower === 'no' || lower === 'n' || lower === '0') {
      return false
    }
  }

  return null
}

function posIntString(value: string | undefined) {
  // Handle undefined or null input
  if (value == null) {
    return null
  }

  // Convert to number and check for valid positive integer
  const parsed = parseInt(value, 10)

  // Check if parsed value is a valid positive integer
  return (Number.isInteger(parsed) && parsed > 0) ? parsed : null
}

function posFloatString(value: string | undefined) {
  // Handle undefined or null input
  if (value == null) {
    return null
  }

  // Convert to number and check for valid positive integer
  const parsed = parseFloat(value.trim())

  // Check if parsed value is a valid positive integer
  return (!isNaN(parsed) && parsed > 0) ? parsed : null
}

function parseUpDirection(input?: string): UpDirection | undefined {
  if (!input) {
    return undefined
  }
  if (['+z', '-z', '+x', '-x', '+y', '-y'].includes(input.toLowerCase())) {
    return input.toLowerCase() as UpDirection
  } else {
    return undefined
  }
}

function removeMatchingFiles(dirPath: string, match: RegExp) {
  const files = fs.readdirSync(dirPath)
  for (const file of files) {
    if (match.test(file) && fs.statSync(path.join(dirPath, file)).isFile()) {
      fs.unlinkSync(path.join(dirPath, file))
    }
  }
}

function removeStaticPreviews(dirPath: string, fileBaseName: string) {
  removeMatchingFiles(dirPath, new RegExp(`^${escapeRegExp(fileBaseName)}_preview_s(_.*)?\\.avif$`))
}

function removeAnimatedPreviews(dirPath: string, fileBaseName: string) {
  removeMatchingFiles(dirPath, new RegExp(`^${escapeRegExp(fileBaseName)}_preview_a(_.*)?\\.avif$`))
}

// replace with RegExp.escape when available
const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Shuffle an array in place. Returns the array for easier chaining
function arrShuffle(arr: unknown[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// Recursively walk through directory
function walkDirectory(currentPath: string, currentDataPackage?: DataPackage) {
  // Read contents of current directory
  let files = fs.readdirSync(currentPath)

  // check for a data package
  if (fs.existsSync(path.join(currentPath, 'datapackage.json')) && (fs.statSync(path.join(currentPath, 'datapackage.json'))).isFile()) {
    const newDataPackage = JSON.parse(fs.readFileSync(path.join(currentPath, 'datapackage.json')).toString()) as DataPackage
    newDataPackage.dataPath = currentPath
    currentDataPackage = newDataPackage
  }

  const dirs = files.filter((f) => {
    const p = path.join(currentPath, f)
    return fs.statSync(p).isDirectory()
  }).sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })

  files = files.filter((f) => {
    const p = path.join(currentPath, f)
    return fs.statSync(p).isFile() && EXT_LIST.includes(path.extname(f).toLowerCase().replace('.', ''))
  }).sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })

  files = files.concat(dirs).filter(f =>
    !IGNORE_LIST.some(i =>
      path.join(currentPath.toLowerCase(), f.toLowerCase()).includes(i.toLowerCase()),
    ),
  )

  if (RANDOM_ORDER) {
    arrShuffle(files)
  }

  for (const fileName of files) {
    // Get full path of current file
    const filePath = path.join(currentPath, fileName)

    if (fs.statSync(filePath).isDirectory()) {
      walkDirectory(filePath, currentDataPackage)
    } else if (fs.statSync(filePath).isFile()) {
      // Add to list of all found files
      foundFiles.push(filePath)

      // Find in datapackage.json
      const resource = currentDataPackage?.resources.find(r => path.join(currentDataPackage.dataPath, r.path) === filePath)

      if (resource) {
        resource.up = parseUpDirection(resource.up)
      }

      // Cleanup files stored in cache directory from any previous runs
      if (!DRY_RUN) {
        removeMatchingFiles(TEMP_DIR, new RegExp('.*'))
      }

      try {
        // extra f3d cmd options and output file name modifiers
        let cmdOptions = ''
        let filenameOptions = ''
        if (resource?.up) {
          cmdOptions += ` --up="${resource.up}"`
          filenameOptions += `_${resource.up.replace('+', '').replace('-', 'n')}`
        } else {
          cmdOptions += ` --up="+z"`
          filenameOptions += `_z`
        }

        // Get input file base name without extension
        const fileBaseName = path.basename(fileName, path.extname(fileName))

        const cachedFilePath = path.join(TEMP_DIR, fileName)

        // GENERATE PNG PREVIEW
        if (RM_STATIC) {
          if (!DRY_RUN) {
            removeStaticPreviews(currentPath, fileBaseName)
          }
        } else if (GEN_STATIC) {
          // Replace extension with .png
          const previewFileBaseName = `${fileBaseName}_preview_s${filenameOptions}`
          const previewCachePngPath = path.join(TEMP_DIR, `${previewFileBaseName}.png`)
          const previewCacheAvifPath = path.join(TEMP_DIR, `${previewFileBaseName}.avif`)
          const previewOutputPath = path.join(currentPath, `${previewFileBaseName}.avif`)

          if (!fs.existsSync(previewOutputPath) || OVERWRITE) {
            if (DRY_RUN) {
              successStaticFiles.push({ filePath, duration: 1 })
            } else {
              console.log(`📘 ${previewOutputPath}`)

              // put file in temp directory
              if (!existsSync(cachedFilePath)) {
                fs.cpSync(filePath, cachedFilePath)
              }

              // Make preview image
              try {
                const startTime = new Date()

                execSync(
                  `f3d "${cachedFilePath}" --config="${F3D_CONFIG_PATH}" --output="${previewCachePngPath}"${cmdOptions}`,
                  { stdio: ['pipe', 'pipe', 'pipe'] })

                // use ffmpeg to compress to avif
                execSync(
                  `ffmpeg -y -framerate ${String(ANIM_FPS)} -i "${previewCachePngPath}" -c:v libsvtav1 -preset 1 -crf 10 -pix_fmt yuv420p -svtav1-params tune=0:fast-decode=1:avif=1 "${previewCacheAvifPath}"`,
                  { stdio: ['ignore', 'pipe', 'pipe'] })

                const duration = Math.ceil(((new Date()).getTime() - startTime.getTime()) / 1000)

                if (fs.existsSync(previewOutputPath) && !OVERWRITE) {
                  console.error(`📙 Output file already exists, and OVERWRITE is "false" or unset. This could be a collision with another instance.`)
                  if (!collisionFiles.includes(filePath)) {
                    collisionFiles.push(filePath)
                  }
                } else {
                  removeStaticPreviews(currentPath, fileBaseName)
                  fs.cpSync(previewCacheAvifPath, previewOutputPath)
                  successStaticFiles.push({ filePath, duration })
                  const average = successStaticFiles.reduce((sum, value) => sum + value.duration, 0) / successStaticFiles.length
                  console.log(`${String(duration)} seconds; average: ${String(average)} seconds per static preview.`)
                }
              } catch (error) {
                console.error(`📕 Error generating PNG preview:`, (error as Error).message)
                if (!errorFiles.includes(filePath)) {
                  errorFiles.push(filePath)
                }
              }
            }
          }
        }

        // GENERATE ANIMATED PREVIEW
        if (RM_ANIM) {
          if (!DRY_RUN) {
            removeAnimatedPreviews(currentPath, fileBaseName)
          }
        } else if (GEN_ANIM) {
          // Replace extension with .avif
          const animatedFileName = `${fileBaseName}_preview_a${filenameOptions}.avif`
          const animatedCachePath = path.join(TEMP_DIR, animatedFileName)
          const animatedOutputPath = path.join(currentPath, animatedFileName)

          if (!fs.existsSync(animatedOutputPath) || OVERWRITE) {
            if (DRY_RUN) {
              successAnimFiles.push({ filePath, duration: 1 })
            } else {
              console.log(`📘 ${animatedOutputPath}`)

              // put file in temp directory
              if (!existsSync(cachedFilePath)) {
                fs.cpSync(filePath, cachedFilePath)
              }

              const commandScriptPath = path.join(TEMP_DIR, `${fileBaseName}_cmd.txt`)
              // Make preview images
              try {
                const startTime = new Date()

                for (let i = 0; i < ANIM_DUR * ANIM_FPS; i++) {
                  // write new command script for each image
                  if (!fs.existsSync(commandScriptPath)) {
                    fs.writeFileSync(commandScriptPath, '')
                  }
                  fs.truncateSync(commandScriptPath, 0)
                  fs.writeFileSync(commandScriptPath, `
                    set_camera front
                    azimuth_camera ${String(Math.round((360.0 / (ANIM_DUR * ANIM_FPS)) * i))}`,
                  )
                  // Render frame
                  execSync(
                    `f3d "${cachedFilePath}" --config="${F3D_CONFIG_PATH}" --command-script="${commandScriptPath}" --output="${path.join(TEMP_DIR, `${fileBaseName}_${String(i).padStart(3, '0')}.png`)}"${cmdOptions}`,
                    { stdio: ['pipe', 'pipe', 'pipe'] })
                }

                // use ffmpeg to create avif video
                execSync(
                  `ffmpeg -y -framerate ${String(ANIM_FPS)} -i "${path.join(TEMP_DIR, `${fileBaseName}_%03d.png`)}" -c:v libsvtav1 -preset 1 -crf 20 -g ${String(Math.min(Math.round(ANIM_FPS / 2), 1))} -pix_fmt yuv420p -svtav1-params tune=0:fast-decode=1 "${animatedCachePath}"`,
                  { stdio: ['ignore', 'pipe', 'pipe'] })

                const duration = Math.ceil(((new Date()).getTime() - startTime.getTime()) / 1000)

                if (fs.existsSync(animatedOutputPath) && !OVERWRITE) {
                  console.error(`📙 Output file already exists, and OVERWRITE is "false" or unset. This could be a collision with another instance.`)
                  if (!collisionFiles.includes(filePath)) {
                    collisionFiles.push(filePath)
                  }
                } else {
                  // TODO: Retry System
                  //  at this point significant compute has been used to generate the animated preview
                  //  so we should try not to lose it.
                  removeAnimatedPreviews(currentPath, fileBaseName)
                  fs.cpSync(animatedCachePath, animatedOutputPath)
                  successAnimFiles.push({ filePath, duration })
                  const average = successAnimFiles.reduce((sum, value) => sum + value.duration, 0) / successAnimFiles.length
                  console.log(`${String(duration)} seconds; average: ${String(average)} seconds per animated preview.`)
                }
              } catch (error) {
                console.error(`📕 Error generating Animated preview:`, (error as Error).message)
                if (!errorFiles.includes(filePath)) {
                  errorFiles.push(filePath)
                }
              }
            }
          }
        }
      } finally {
        // Cleanup files stored in cache directory
        if (!DRY_RUN) {
          removeMatchingFiles(TEMP_DIR, new RegExp('.*'))
        }
      }
    }
  }
}

// Make sure TEMP_DIR exists and is directory
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR)
}
if (!fs.statSync(TEMP_DIR).isDirectory()) {
  throw new Error(`${TEMP_DIR} must be a directory.`)
}

process.on('SIGINT', function () {
  process.exit(0)
})
process.on('SIGTERM', function () {
  process.exit(0)
})

process.on('exit', () => {
  console.log(`📓 ${String(foundFiles.length)} model files found.`)
  if (errorFiles.length) {
    console.log(`📕 ${String(errorFiles.length)} files had preview generation errors.`)
  }
  if (collisionFiles.length) {
    console.log(`📙 ${String(collisionFiles.length)} files had collisions where multiple instances generated a preview for the same file.`)
  }
  if (!DRY_RUN) {
    console.log(`📗 ${String(successStaticFiles.length)} successfully created static preview files.`)
    console.log(`📗 ${String(successAnimFiles.length)} successfully created animated preview files.`)
  } else {
    console.log(`📘 ${String(successStaticFiles.length)} static preview files need to be created.`)
    console.log(`📘 ${String(successAnimFiles.length)} animated preview files need to be created.`)
  }
})

// Start walking from the initial directory
walkDirectory(MODELS_DIR)
