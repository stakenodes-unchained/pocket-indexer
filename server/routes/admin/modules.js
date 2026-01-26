const express = require('express');
const router = express.Router();
const userManagementService = require('../../services/userManagementService');

/**
 * @route GET /api/admin/modules
 * @desc Get all modules
 * @access Admin
 */
router.get('/', async (req, res) => {
  try {
    const modules = await userManagementService.getAllModules();

    res.json({
      success: true,
      data: modules,
    });
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
