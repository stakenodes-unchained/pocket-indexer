const express = require('express');
const router = express.Router();

// Import admin route modules
const usersRoutes = require('./users');
const rolesRoutes = require('./roles');
const modulesRoutes = require('./modules');
const configRoutes = require('./config');
const rateLimitsRoutes = require('./rateLimits');

// Mount routes
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/modules', modulesRoutes);
router.use('/config', configRoutes);
router.use('/rate-limits', rateLimitsRoutes);

module.exports = router;
