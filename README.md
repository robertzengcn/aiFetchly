# AiFetchly

This project is mainly for AI-powered marketing automation (aiFetchly) on social media platforms like Facebook, Twitter, YouTube.

This program need backgroud web service to peresit data, You should set up your own backgroud service

#### How the program work

1. First you have to manuly create account at some social platfom, and create a compaign then save account info in backgroud service

2. Defined the api address in local client environment file, edit the .env file

##### Some function
## login social platform

Run the start command

### Login campaign
```
npm run login -c compaignid
```

For example
```
npm run login -c "17"
```
login mean ask the program to login into social media platform, the compaign id should be return from backend service


The program shoud do follow job, get username credentials from backgroud service, open login page, and login, some platform may require use make some manual action

### Develop
Start electron
```
yarn electron:serve
```

### run task

Run task from command line
```
npm run task 
```



#### Debug method
debug the function, for example
```
DEBUG='bilibili-scraper:Scraper' npm run testdownload
```

### How to test
test for single module, for example, save single link to remote
```
npx mocha test test/modules --grep video-url-list
```

test google scraper

```
yarn vitest-googlescraper
```

### Type check
run a parallel task doing checks, i.e. for typescript:
```
tsc --noEmit --watch
```

### Icon library

https://pictogrammers.com/library/mdi/














