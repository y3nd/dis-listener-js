# node SEA build instruction Single executable applications
## 1. Create dist dir
```sh
mkdir dist
```
## 2. Copy the nodejs exe
```sh
node -e "require('fs').copyFileSync(process.execPath, './dist/dis-listener.exe')"
```
## 3. Create dist js file
```sh
npm install # update/install dependencies
npm run build
```
## 4. Generate the blob file
```sh
node --experimental-sea-config sea-config.json
```
## 5. Inject program in exe
```sh
npx postject ./dist/dis-listener.exe NODE_SEA_BLOB ./dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
```