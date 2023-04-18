// --- GENERATED BY YMIR ---

// needed validation functions
const isInt = (str) => {
    const v = parseInt(str);
    return !isNaN(v) && isFinite(v);
};
const isFloat = (str) => {
    const v = parseFloat(str);
    return !isNaN(v) && isFinite(v);
};
const isBoolean = (str) => {
    return str === "true" || str === "false";
};
const isDate = (str) => {
    return !isNaN(Date.parse(str));
};
const isDatetime = isDate;
const isTime = isDate;
const isString = (str) => true;
const getHeader = (headers, name) => {
    const header = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
    return header === undefined ? undefined : headers[header];
};

const errorMessage = {
    _400: "Bad Request: Field {field} of type {type} is required",
    _401: "Unauthorized: You are not authorized to access this resource",
    _403: "Forbidden: You are not allowed to access this resource",
    _404: "Not Found: The requested resource could not be found",
    _500: "Internal Server Error: An internal server error occurred",
    Started: "Server started on port {port}...",
};

const express = require("express");
const app = express();

require("dotenv").config();
app.use(require("cors")({origin: process.env.ALLOWED_ORIGIN}));

class YmirRestBase {
    
    async authenticateApiKey(apiKey) {
        return true;
    }
    
    async #handleApiKeyAuthentication(req, res) {
        const apiKey = getHeader(req.headers, "X-API-Key");
        if (apiKey === undefined) {
            res.status(401).send(errorMessage._401);
            return undefined;
        }
    
        const isValid = await this.authenticateApiKey(apiKey);
        if (!isValid) {
            res.status(401).send(errorMessage._401);
            return undefined;
        }
    
        return apiKey;
    }
    
    async authorizeApiKey(apiKey, roles) {
        return true;
    }
    
    onApiRouterHelloRoute(req, res) {
        if (req.query === undefined) {
            res.status(400).send(errorMessage._400.replace("{field}", "query").replace("{type}", "object"));
            return false;
        }
    
        const query = req.query;
        if (query.name === undefined) {
            res.status(400).send(errorMessage._400.replace("{field}", "query.name").replace("{type}", "string"));
            return false;
        }
        if (!isString(query.name)) {
            res.status(400).send(errorMessage._400.replace("{field}", "query.name").replace("{type}", "string"));
            return false;
        }
    
        return true;
    }
    
    onApiRouterCreatePerson(req, res) {
        if (req.body === undefined) {
            res.status(400).send(errorMessage._400.replace("{field}", "body").replace("{type}", "object"));
            return false;
        }
    
        const body = req.body;
        if (body["name"] === undefined) {
            res.status(400).send(errorMessage._400.replace("{field}", "body.name").replace("{type}", "string"));
            return false;
        }
        if (!isString(body["name"])) {
            res.status(400).send(errorMessage._400.replace("{field}", "body.name").replace("{type}", "string"));
            return false;
        }
    
        if (body["age"] === undefined) {
            res.status(400).send(errorMessage._400.replace("{field}", "body.age").replace("{type}", "int"));
            return false;
        }
        if (!isInt(body["age"])) {
            res.status(400).send(errorMessage._400.replace("{field}", "body.age").replace("{type}", "int"));
            return false;
        }
    
        return true;
    }
    
    onApiRouterHelloRouteAnotherFile(req, res) {
        return true;
    }

    build(app) {
        // Routers
        const apiRouter = express.Router();
        apiRouter.use((req, res, next) => {
            const validate = (req, res) => {
                if (req.headers === undefined) {
                    res.status(400).send(errorMessage._400.replace("{field}", "header").replace("{type}", "object"));
                    return false;
                }
            
                const header = req.headers;
                if (getHeader(header, "X-API-Key") === undefined) {
                    res.status(400).send(errorMessage._400.replace("{field}", "header.X-API-Key").replace("{type}", "string"));
                    return false;
                }
                if (!isString(getHeader(header, "X-API-Key"))) {
                    res.status(400).send(errorMessage._400.replace("{field}", "header.X-API-Key").replace("{type}", "string"));
                    return false;
                }
            
                return true;
            };
        
            if (!validate(req, res)) {
                return;
            }
        
            next();
        });
        apiRouter.use(async (req, res, next) => {
            const authResult = await this.#handleApiKeyAuthentication(req, res);
            if (authResult === undefined) {
                return;
            }
            const isAuthorized = await this.authorizeApiKey(authResult, ["admin"]);
            if (!isAuthorized) {
                res.status(403).send(errorMessage._403);
                return;
            }
        
            next();
        });
        app.use("/api", apiRouter);
        // Routes
        apiRouter.get("/hello", this.onApiRouterHelloRoute.bind(this));
        apiRouter.post("/person", this.onApiRouterCreatePerson.bind(this));
        apiRouter.get("/hello-from-another-file", this.onApiRouterHelloRouteAnotherFile.bind(this));
        app.use((err, req, res, next) => {
            if (err) {
                res.status(500).send(errorMessage._500);
            } else {
                res.status(404).send(errorMessage._404);
            }
        });
    }
}

const startServer = (runtime) => {
    const ymir = new runtime();
    ymir.build(app);
    app.listen(process.env.PORT || 3000, () => {
        console.log(errorMessage.Started.replace("{port}", process.env.PORT || 3000));
    });
};

module.exports = {startServer, errorMessage, YmirRestBase};