const express = require('express');

const app = express();

const errorMessage = {
    400: 'Bad Request: Field %s of type %s is required'
};

class RestBase {

    get router() {
        throw new Error('Not implemented');
    }
}

class Rest extends RestBase {

    get router() {
        return "";
    }

}