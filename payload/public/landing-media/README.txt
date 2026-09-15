RMC Landing Media

How to update media without editing HTML:
1) Drop your client photos/videos into this folder.
2) Refresh http://localhost:3000/

Auto rules used by the landing page:
- First video file becomes hero video.
- First image file becomes hero image.
- Next images fill the 6 gallery slots.
- Supported images: .jpg .jpeg .png .webp .avif .gif
- Supported videos: .mp4 .webm .ogg .mov

Notes:
- Filenames can be anything. No fixed naming required.
- If no media is found, the page uses placeholder.svg.
