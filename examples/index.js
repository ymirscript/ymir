const ymir = require("./build/ymir_base.js");

const accounts = [
    {
        id: 1,
        username: "Admin",
        password: "123"
    },
]

class App extends ymir.YmirRestBase {
    
    async validateJwtPayloadForApiKey(payload) {
        return true;
    }

    async getJwtPayloadForApiKey(username, password) {
        return accounts.find(x => x.username === username && x.password === password);
    }
}

ymir.startServer(App);