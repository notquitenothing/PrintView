export type UpDirection = '+z' | '-z' | '+x' | '-x' | '+y' | '-y'

export interface DataPackage {
  dataPath: string
  $schema: string
  name: string
  title: string
  homepage: string
  image: string
  keywords: string[]
  resources: {
    name: string
    path: string
    mediatype: string
    up?: UpDirection
    presupported: boolean
  }[]
  sensitive: boolean
  contributors: {
    title: string
    path: string
    roles: string[]
    links: string[]
  }[]
  links: {
    path: string
  }[]
}
