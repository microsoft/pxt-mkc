all:
	npm run compile

bump: all
	npm version patch

pub: bump
	npm publish
