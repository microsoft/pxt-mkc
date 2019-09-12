export const files: {[index: string]: string} = {
"pxt.json": `
{
    "name": "untitled",
    "version": "0.0.0",
    "description": "An empty MakeCode Arcade project",
    "dependencies": {
        "device": "*"
    },
    "files": [
        "main.ts"
    ],
    "testFiles": [
        "test.ts"
    ],
    "public": true
}
`,


"main.ts": `

const myFont = image.font8;

const mySprite = sprites.create(image.create(myFont.charWidth * 6, myFont.charHeight * 2), SpriteKind.Player);
mySprite.image.print("Hello", 0, 0, 0, myFont); 
mySprite.image.print("World!", 0, myFont.charHeight, 0, myFont); 
mySprite.setFlag(SpriteFlag.BounceOnWall, true);
mySprite.setVelocity(20, 30);
`,


"test.ts": `
console.log("Hello test!");
`,


"tsconfig.json": `
{
    "compilerOptions": {
        "target": "es5",
        "noImplicitAny": true,
        "outDir": "built",
        "rootDir": "."
    },
    "include": [
        "./*.ts",
        "./pxt_modules/*/*.ts"
    ]
}
`,


".gitignore": `
built
node_modules
pxt_modules
*.db
*.tgz
.header.json
`
}