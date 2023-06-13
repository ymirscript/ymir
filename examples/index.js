const ymir = require("./build/ymir_base.js");

const accounts = [
    {
        id: 1,
        username: "Admin",
        password: "123"
    },
]

const persons = [];

class App extends ymir.YmirRestBase {
    
    async validateJwtPayloadForApiKey(payload) {
        return accounts.find(x => x.id === payload.id);
    }

    async getJwtPayloadForApiKey(username, password) {
        return accounts.find(x => x.username === username && x.password === password);
    }

    async onApiRouterCreatePerson(req, res) {
        if (await super.onApiRouterCreatePerson(req, res) !== true) {
            return;
        }

        const person = req.body;
        person.id = persons.length + 1;
        persons.push(person);
        res.json({ success: true, message: 'Person created successfully' });
    }

    async onApiRouterGetPersons(req, res) {
        if (await super.onApiRouterGetPersons(req, res) !== true) {
            return;
        }

        res.json(persons);
    }

    async onApiRouterGetPerson(req, res) {
        if (await super.onApiRouterGetPerson(req, res) !== true) {
            return;
        }

        const person = persons.find(x => x.id === parseInt(req.params.id));
        if (!person) {
            return res.status(404).json({ success: false, message: 'Person not found' });
        }

        res.json(person);
    }

    async onApiRouterUpdatePerson(req, res) {
        if (await super.onApiRouterUpdatePerson(req, res) !== true) {
            return;
        }

        const person = persons.find(x => x.id === parseInt(req.params.id));
        if (!person) {
            return res.status(404).json({ success: false, message: 'Person not found' });
        }

        person.name = req.body.name;
        person.age = req.body.age;
        person.address = req.body.address;
        res.json({ success: true, message: 'Person updated successfully' });
    }

    async onApiRouterDeletePerson(req, res) {
        if (await super.onApiRouterDeletePerson(req, res) !== true) {
            return;
        }

        const person = persons.find(x => x.id === parseInt(req.params.id));
        if (!person) {
            return res.status(404).json({ success: false, message: 'Person not found' });
        }

        const index = persons.indexOf(person);
        persons.splice(index, 1);
        res.json({ success: true, message: 'Person deleted successfully' });
    }
}

ymir.startServer(App);