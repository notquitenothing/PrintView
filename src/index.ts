import fs, { existsSync } from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { DataPackage, UpDirection } from './types/DataPackage'

const MODELS_DIR = process.env.MODELS_DIR ?? '/models'

const INPUT_EXTS = process.env.INPUT_EXTS ?? 'stl,obj'

const GEN_STATIC = booleanString(process.env.GEN_STATIC) ?? true
const GEN_ANIM = booleanString(process.env.GEN_ANIM)

const OVERWRITE = booleanString(process.env.OVERWRITE)
const REMOVE_EXISTING = booleanString(process.env.REMOVE_EXISTING)

const ANIM_FPS = posIntString(process.env.ANIM_FPS) ?? 30
const ANIM_DUR = parseFloat((posFloatString(process.env.ANIM_DUR) ?? 6).toFixed(1))

const TEMP_DIR = './temp'
const F3D_CONFIG_PATH = path.join('./resources', 'f3d_config.json')

const EXT_LIST = INPUT_EXTS.split(' ')
  .join(',')
  .split(';')
  .join(',')
  .split(',')

const errorFiles: string[] = []
const successFiles: string[] = []

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

  files.forEach((fileName) => {
    // Get full path of current file
    const filePath = path.join(currentPath, fileName)

    // Find in datapackage.json
    const resource = currentDataPackage?.resources.find(r => path.join(currentDataPackage.dataPath, r.path) === filePath)

    if (resource) {
      resource.up = parseUpDirection(resource.up)
    }
    const cachedFilePath = path.join(TEMP_DIR, fileName)

    // Cleanup files stored in cache directory from any previous runs
    removeMatchingFiles(TEMP_DIR, new RegExp('.*'))

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

      // If REMOVE_EXISTING then remove existing previews before starting
      if (REMOVE_EXISTING) {
        removeStaticPreviews(currentPath, fileBaseName)
        removeAnimatedPreviews(currentPath, fileBaseName)
      }

      // GENERATE PNG PREVIEW
      if (GEN_STATIC) {
      // Replace extension with .png
        const previewFileBaseName = `${fileBaseName}_preview_s${filenameOptions}`
        const previewCachePngPath = path.join(TEMP_DIR, `${previewFileBaseName}.png`)
        const previewCacheAvifPath = path.join(TEMP_DIR, `${previewFileBaseName}.avif`)
        const previewOutputPath = path.join(currentPath, `${previewFileBaseName}.avif`)

        if (!fs.existsSync(previewOutputPath) || OVERWRITE) {
          console.log(previewOutputPath)

          // put file in temp directory
          if (!existsSync(cachedFilePath)) {
            fs.cpSync(filePath, cachedFilePath)
          }

          // Make preview image
          try {
            execSync(
              `f3d "${cachedFilePath}" --config="${F3D_CONFIG_PATH}" --output="${previewCachePngPath}"${cmdOptions}`,
              { stdio: ['pipe', 'pipe', 'pipe'] })

            // use ffmpeg to compress to avif
            execSync(
              `ffmpeg -y -framerate ${String(ANIM_FPS)} -i "${previewCachePngPath}" -c:v libsvtav1 -preset 1 -crf 10 -pix_fmt yuv420p -svtav1-params tune=0:fast-decode=1:avif=1 "${previewCacheAvifPath}"`,
              { stdio: ['ignore', 'pipe', 'pipe'] })

            removeStaticPreviews(currentPath, fileBaseName)
            fs.cpSync(previewCacheAvifPath, previewOutputPath)
            if (!successFiles.includes(filePath)) {
              successFiles.push(filePath)
            }
          } catch (error) {
            console.error(`Error generating PNG preview:`, (error as Error).message)
            if (!errorFiles.includes(filePath)) {
              errorFiles.push(filePath)
            }
          }
        }
      }

      // GENERATE ANIMATED PREVIEW
      if (GEN_ANIM) {
        // Replace extension with .avif
        const animatedFileName = `${fileBaseName}_preview_a${filenameOptions}.avif`
        const animatedCachePath = path.join(TEMP_DIR, animatedFileName)
        const animatedOutputPath = path.join(currentPath, animatedFileName)

        if (!fs.existsSync(animatedOutputPath) || OVERWRITE) {
          console.log(animatedOutputPath)

          // put file in temp directory
          if (!existsSync(cachedFilePath)) {
            fs.cpSync(filePath, cachedFilePath)
          }

          const commandScriptPath = path.join(TEMP_DIR, `${fileBaseName}_cmd.txt`)
          // Make preview images
          try {
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

            removeAnimatedPreviews(currentPath, fileBaseName)
            fs.cpSync(animatedCachePath, animatedOutputPath)
            if (!successFiles.includes(filePath)) {
              successFiles.push(filePath)
            }
          } catch (error) {
            console.error(`Error generating Animated preview:`, (error as Error).message)
            if (!errorFiles.includes(filePath)) {
              errorFiles.push(filePath)
            }
          }
        }
      }
    } finally {
      // Cleanup files stored in cache directory
      removeMatchingFiles(TEMP_DIR, new RegExp('.*'))
    }
  })

  dirs.forEach((dir) => {
    walkDirectory(path.join(currentPath, dir), currentDataPackage)
  })
}

// Make sure TEMP_DIR exists and is directory
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR)
}
if (!fs.statSync(TEMP_DIR).isDirectory()) {
  throw new Error(`${TEMP_DIR} must be a directory!`)
}

// Start walking from the initial directory
walkDirectory(MODELS_DIR)
if (errorFiles.length) {
  console.error(`The following ${String(errorFiles.length)} files had issues:\n`, errorFiles.join('\n'))
}
if (successFiles.length) {
  console.log(`Created ${String(successFiles.length)} preview files.`)
}
console.log('Done generating previews.')
