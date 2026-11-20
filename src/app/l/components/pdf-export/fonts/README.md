# Fonts for lesson PDFs

Embedded in the PDFs learners download (`../file-export.tsx`), because the built-in PDF fonts can't
show letters such as č or đ.

- `inter-400.ttf`, `inter-600.ttf`: Inter by The Inter Project Authors (https://github.com/rsms/inter),
  Copyright 2020, SIL Open Font License 1.1.
- `inter-400-italic.ttf`, `inter-600-italic.ttf`: Inter Italic and SemiBold Italic 3.19, same authors and
  licence, from the `inter-ui` npm package (`Inter (web)/*.woff`).
- `jetbrains-mono-400.ttf`: JetBrains Mono by The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono), Copyright 2020, SIL Open Font License 1.1.

The upright Inter and JetBrains Mono are the copies Prisma ships
(`node_modules/prisma/build/public/assets/*.woff`). All are unpacked from WOFF to TTF (the same
tables): the PDF library reads TTF.
