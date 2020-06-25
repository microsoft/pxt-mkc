all:
	npm run compile

bump:
	npm version patch

pub: all
	npm publish
