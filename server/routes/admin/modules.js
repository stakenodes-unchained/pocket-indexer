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

/**
 * @route GET /api/admin/modules/:id
 * @desc Get module by ID
 * @access Admin
 */
router.get('/:id', async (req, res) => {
  try {
    const moduleId = parseInt(req.params.id);

    const module = await userManagementService.getModuleById(moduleId);

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    res.json({
      success: true,
      data: module,
    });
  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/modules
 * @desc Create new module
 * @access Admin
 */
router.post('/', async (req, res) => {
  try {
    const { name, slug, description, endpoints } = req.body;

    // Validation
    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        error: 'Name and slug are required',
      });
    }

    if (endpoints && !Array.isArray(endpoints)) {
      return res.status(400).json({
        success: false,
        error: 'Endpoints must be an array',
      });
    }

    const moduleData = { name, slug, description, endpoints };
    const module = await userManagementService.createModule(moduleData);

    res.status(201).json({
      success: true,
      data: module,
      message: 'Module created successfully',
    });
  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/modules/:id
 * @desc Update module
 * @access Admin
 */
router.put('/:id', async (req, res) => {
  try {
    const moduleId = parseInt(req.params.id);
    const { name, description, endpoints, is_active } = req.body;

    if (endpoints !== undefined && !Array.isArray(endpoints)) {
      return res.status(400).json({
        success: false,
        error: 'Endpoints must be an array',
      });
    }

    const moduleData = { name, description, endpoints, is_active };
    const module = await userManagementService.updateModule(moduleId, moduleData);

    res.json({
      success: true,
      data: module,
      message: 'Module updated successfully',
    });
  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/admin/modules/:id
 * @desc Delete module
 * @access Admin
 */
router.delete('/:id', async (req, res) => {
  try {
    const moduleId = parseInt(req.params.id);

    const deleted = await userManagementService.deleteModule(moduleId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    res.json({
      success: true,
      message: 'Module deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
