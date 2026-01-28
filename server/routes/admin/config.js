const express = require('express');
const router = express.Router();
const systemConfigService = require('../../services/systemConfigService');

/**
 * Middleware to check if user is super-admin
 * This is an additional layer of protection beyond RBAC
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'super-admin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Super-admin privileges required.',
    });
  }
  next();
};

// Apply super-admin check to all routes
router.use(requireSuperAdmin);

/**
 * @route GET /api/admin/config
 * @desc Get all configurations grouped by category
 * @access Super-Admin only
 */
router.get('/', async (req, res) => {
  try {
    const includeSensitive = req.query.include_sensitive === 'true';
    const configs = await systemConfigService.getAllConfigs(includeSensitive);

    res.json({
      success: true,
      data: {
        categories: systemConfigService.getCategories(),
        configs,
      },
    });
  } catch (error) {
    console.error('Error fetching configurations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/config/categories
 * @desc Get available configuration categories
 * @access Super-Admin only
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = systemConfigService.getCategories();

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/config/category/:category
 * @desc Get configurations for a specific category
 * @access Super-Admin only
 */
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const includeSensitive = req.query.include_sensitive === 'true';

    const configs = await systemConfigService.getConfigsByCategory(category, includeSensitive);

    res.json({
      success: true,
      data: {
        category,
        configs,
      },
    });
  } catch (error) {
    console.error('Error fetching category configurations:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/config/:id
 * @desc Get a specific configuration by ID
 * @access Super-Admin only
 */
router.get('/:id', async (req, res) => {
  try {
    const configId = parseInt(req.params.id);

    if (isNaN(configId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration ID',
      });
    }

    const config = await systemConfigService.getConfigById(configId);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Error fetching configuration:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/config/:id
 * @desc Update a configuration value
 * @access Super-Admin only
 */
router.put('/:id', async (req, res) => {
  try {
    const configId = parseInt(req.params.id);
    const { value, reason } = req.body;

    if (isNaN(configId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration ID',
      });
    }

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Value is required',
      });
    }

    const requestInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
    };

    const config = await systemConfigService.updateConfig(
      configId,
      value,
      req.user.accountId,
      requestInfo,
      reason || null
    );

    res.json({
      success: true,
      data: config,
      message: config.requiresRestart
        ? 'Configuration updated. Service restart required for changes to take effect.'
        : 'Configuration updated successfully.',
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/config/bulk
 * @desc Update multiple configurations at once
 * @access Super-Admin only
 */
router.put('/bulk/update', async (req, res) => {
  try {
    const { updates, reason } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Updates array is required',
      });
    }

    // Validate each update
    for (const update of updates) {
      if (!update.id || update.value === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Each update must have an id and value',
        });
      }
    }

    const requestInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
    };

    const result = await systemConfigService.bulkUpdateConfigs(
      updates,
      req.user.accountId,
      requestInfo,
      reason || 'Bulk update'
    );

    const requiresRestart = result.results.some(r => r.requiresRestart);

    res.json({
      success: true,
      data: result,
      message: requiresRestart
        ? 'Configurations updated. Some changes require service restart.'
        : 'Configurations updated successfully.',
    });
  } catch (error) {
    console.error('Error bulk updating configurations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/config/:id/reset
 * @desc Reset a configuration to its default value
 * @access Super-Admin only
 */
router.post('/:id/reset', async (req, res) => {
  try {
    const configId = parseInt(req.params.id);

    if (isNaN(configId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration ID',
      });
    }

    const requestInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
    };

    const config = await systemConfigService.resetToDefault(
      configId,
      req.user.accountId,
      requestInfo
    );

    res.json({
      success: true,
      data: config,
      message: 'Configuration reset to default value.',
    });
  } catch (error) {
    console.error('Error resetting configuration:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/config/category/:category/reset
 * @desc Reset all configurations in a category to defaults
 * @access Super-Admin only
 */
router.post('/category/:category/reset', async (req, res) => {
  try {
    const { category } = req.params;

    const requestInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
    };

    const result = await systemConfigService.resetCategoryToDefaults(
      category,
      req.user.accountId,
      requestInfo
    );

    res.json({
      success: true,
      data: result,
      message: `Category "${category}" reset to default values.`,
    });
  } catch (error) {
    console.error('Error resetting category:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/config/audit
 * @desc Get configuration audit log
 * @access Super-Admin only
 */
router.get('/audit/log', async (req, res) => {
  try {
    const {
      config_id,
      category,
      changed_by,
      start_date,
      end_date,
      limit,
      offset,
    } = req.query;

    const filters = {
      configId: config_id ? parseInt(config_id) : undefined,
      category,
      changedBy: changed_by ? parseInt(changed_by) : undefined,
      startDate: start_date,
      endDate: end_date,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };

    const result = await systemConfigService.getAuditLog(filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/config/reload
 * @desc Reload all configurations into cache
 * @access Super-Admin only
 */
router.post('/reload', async (req, res) => {
  try {
    await systemConfigService.clearCache();
    await systemConfigService.loadAllConfigs();

    res.json({
      success: true,
      message: 'Configurations reloaded into cache.',
    });
  } catch (error) {
    console.error('Error reloading configurations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/config/export
 * @desc Export all configurations (for backup)
 * @access Super-Admin only
 */
router.get('/export/all', async (req, res) => {
  try {
    const includeSensitive = req.query.include_sensitive === 'true';
    const configs = await systemConfigService.exportConfigs(includeSensitive);

    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        configCount: configs.length,
        configs,
      },
    });
  } catch (error) {
    console.error('Error exporting configurations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/config/import
 * @desc Import configurations (for restore)
 * @access Super-Admin only
 */
router.post('/import', async (req, res) => {
  try {
    const { configs } = req.body;

    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({
        success: false,
        error: 'Configs array is required',
      });
    }

    const requestInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
    };

    const result = await systemConfigService.importConfigs(
      configs,
      req.user.accountId,
      requestInfo
    );

    res.json({
      success: true,
      data: result,
      message: `Import complete. ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors.`,
    });
  } catch (error) {
    console.error('Error importing configurations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
