# PrintView

<p align=center>
<img src="https://raw.githubusercontent.com/notquitenothing/PrintView/refs/heads/main/docs/3DBenchy_preview_a_z.avif" title="3DBenchy" alt="Animated Preview of 3DBenchy."/>
</p>

## What is PrintView?
PrintView is a single-run docker image you can point at a directory containing 3D Model files and will generate sidecar preview images or animations. You can generate static or animated images, with configurable animated preview Frames-Per-Second and Duration. 

## Getting Started

To setup using docker compose, create a `compose.yml` file as follows:

``` yaml
services:
  model-preview-gen: 
    image: notquitenothing/printview:latest
    env_file:
      - .env
    volumes:
      - "/your/models/path/here:/models"
```

and optionally a companion `.env` file based on the content of the `.example.env` file in the source repository. By default only static image previews will be generated.


Then start the process with `docker compose up -d`.  PrintView will scan your `/models` mount and begin generating preview files. You can check progress with `docker compose logs -f` to view process logs.

> [!IMPORTANT]
> Make sure to change the `/models` volume mount in the compose file to your models folder.

> [!WARNING]
> Generating animated previews may take a very long time. All previews are ray-traced and high quality, and the animated previews create many frames before combining them.

## Disclaimer

This project is offered as-is with no warranty.

> [!CAUTION]
> Try the project on a small sample of your 3D Models first. PrintView modifies your model source directory by creating and/or deleting preview files, proceed with caution!

## Credits

[f3d](https://f3d.app)

[ffmpeg](https://ffmpeg.org)
