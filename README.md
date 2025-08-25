# 3DModelPreviewGen

![Benchy Preview](./docs/3DBenchy_preview_a_z.avif)

## What is 3DModelPreviewGen?
3DModelPreviewGen is a single-run docker image you can point at a directory containing 3D Model files and will generate sidecar preview images or animations. You can generate static or animated images, with configurable animated preview Frames-Per-Second and Duration. 

## Getting Started

To setup using docker compose, create a `compose.yml` file as follows:

``` yaml
services:
  model-preview-gen: 
    build:
      context: .
    env_file:
      - .env
    volumes:
      - "/your/models/path/here:/models"
```

and a companion `.env` file based on the content of the `example.env` file in the source repository. An example `.env` file may look like this:

``` sh
OVERWRITE="false"
GEN_STATIC="true"
GEN_ANIM="false"
```

Then start the process with `docker compose up -d`. 3DModelPreviewGen will scan your `/models` mount and begin generating preview files. You can check progress with `docker compose logs -f` to view process logs.

> [!IMPORTANT]
> Make sure to change the `/models` volume mount in the compose file to your models folder.

> [!WARNING]
> Generating animated previews may take a very long time. All previews are ray-traced and high quality, and the animated previews create many frames before combining them.

> [!CAUTION]
> Try the project on a small sample of your 3D Models, 3DModelPreviewGen modifies your source directory of models so proceed with caution!

## Credits

[f3d](https://f3d.app)

[ffmpeg](https://ffmpeg.org)
