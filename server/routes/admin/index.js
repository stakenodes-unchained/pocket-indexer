const express = require('express');
const router = express.Router();

// Import admin route modules
const usersRoutes = require('./users');
const rolesRoutes = require('./roles');
const modulesRoutes = require('./modules');

// Mount routes
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/modules', modulesRoutes);

module.exports = router;
