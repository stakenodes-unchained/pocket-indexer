const express = require('express');
const router = express.Router();
const rateLimitService = require('../../services/rateLimitService');

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
 * @route GET /api/admin/rate-limits
 * @desc Get all rate limit rules
 * @access Super-Admin only
 */
router.get('/', async (req, res) => {
  try {
    const { target_type, enabled, limit, offset } = req.query;

    const filters = {
      targetType: target_type,
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };

    const result = await rateLimitService.getAllRules(filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching rate limit rules:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/rate-limits/target-types
 * @desc Get available target types
 * @access Super-Admin only
 */
router.get('/target-types', async (req, res) => {
  try {
    const targetTypes = rateLimitService.getTargetTypes();

    res.json({
      success: true,
      data: targetTypes.map(type => ({
        value: type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        description: getTargetTypeDescription(type),
      })),
    });
  } catch (error) {
    console.error('Error fetching target types:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get description for target type
 */
function getTargetTypeDescription(type) {
  const descriptions = {
    global: 'Applies to all users and requests',
    role: 'Applies to all users with a specific role',
    user: 'Applies to a specific user',
    endpoint: 'Applies to requests matching an endpoint pattern',
  };
  return descriptions[type] || 'Unknown target type';
}

/**
 * @route GET /api/admin/rate-limits/statistics
 * @desc Get rate limiting statistics
 * @access Super-Admin only
 */
router.get('/statistics', async (req, res) => {
  try {
    const stats = await rateLimitService.getStatistics();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching rate limit statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/rate-limits/:id
 * @desc Get a specific rate limit rule
 * @access Super-Admin only
 */
router.get('/:id', async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);

    if (isNaN(ruleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
    }

    const rule = await rateLimitService.getRuleById(ruleId);

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Rule not found',
      });
    }

    res.json({
      success: true,
      data: rule,
    });
  } catch (error) {
    console.error('Error fetching rate limit rule:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/rate-limits
 * @desc Create a new rate limit rule
 * @access Super-Admin only
 */
router.post('/', async (req, res) => {
  try {
    const {
      name,
      target_type,
      target_id,
      endpoint_pattern,
      requests_limit,
      window_seconds,
      enabled,
      priority,
    } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required',
      });
    }

    if (!target_type) {
      return res.status(400).json({
        success: false,
        error: 'Target type is required',
      });
    }

    if (!requests_limit || requests_limit < 1) {
      return res.status(400).json({
        success: false,
        error: 'Requests limit must be at least 1',
      });
    }

    const ruleData = {
      name,
      targetType: target_type,
      targetId: target_id ? parseInt(target_id) : null,
      endpointPattern: endpoint_pattern || null,
      requestsLimit: parseInt(requests_limit),
      windowSeconds: window_seconds ? parseInt(window_seconds) : 60,
      enabled: enabled !== false,
      priority: priority ? parseInt(priority) : 0,
    };

    const rule = await rateLimitService.createRule(ruleData, req.user.accountId);

    res.status(201).json({
      success: true,
      data: rule,
      message: 'Rate limit rule created successfully.',
    });
  } catch (error) {
    console.error('Error creating rate limit rule:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/rate-limits/:id
 * @desc Update a rate limit rule
 * @access Super-Admin only
 */
router.put('/:id', async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);

    if (isNaN(ruleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
    }

    const {
      name,
      target_type,
      target_id,
      endpoint_pattern,
      requests_limit,
      window_seconds,
      enabled,
      priority,
    } = req.body;

    const ruleData = {};

    if (name !== undefined) ruleData.name = name;
    if (target_type !== undefined) ruleData.targetType = target_type;
    if (target_id !== undefined) ruleData.targetId = target_id ? parseInt(target_id) : null;
    if (endpoint_pattern !== undefined) ruleData.endpointPattern = endpoint_pattern;
    if (requests_limit !== undefined) ruleData.requestsLimit = parseInt(requests_limit);
    if (window_seconds !== undefined) ruleData.windowSeconds = parseInt(window_seconds);
    if (enabled !== undefined) ruleData.enabled = enabled;
    if (priority !== undefined) ruleData.priority = parseInt(priority);

    const rule = await rateLimitService.updateRule(ruleId, ruleData);

    res.json({
      success: true,
      data: rule,
      message: 'Rate limit rule updated successfully.',
    });
  } catch (error) {
    console.error('Error updating rate limit rule:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/admin/rate-limits/:id
 * @desc Delete a rate limit rule
 * @access Super-Admin only
 */
router.delete('/:id', async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);

    if (isNaN(ruleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
    }

    const deleted = await rateLimitService.deleteRule(ruleId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Rule not found',
      });
    }

    res.json({
      success: true,
      message: 'Rate limit rule deleted successfully.',
    });
  } catch (error) {
    console.error('Error deleting rate limit rule:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PATCH /api/admin/rate-limits/:id/toggle
 * @desc Toggle rate limit rule enabled status
 * @access Super-Admin only
 */
router.patch('/:id/toggle', async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const { enabled } = req.body;

    if (isNaN(ruleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
    }

    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Enabled status is required',
      });
    }

    const rule = await rateLimitService.toggleRule(ruleId, enabled);

    res.json({
      success: true,
      data: rule,
      message: `Rate limit rule ${enabled ? 'enabled' : 'disabled'} successfully.`,
    });
  } catch (error) {
    console.error('Error toggling rate limit rule:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/rate-limits/reset/user/:userId
 * @desc Reset rate limit counters for a specific user
 * @access Super-Admin only
 */
router.post('/reset/user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
      });
    }

    const clearedCount = await rateLimitService.resetUserCounters(userId);

    res.json({
      success: true,
      message: `Reset ${clearedCount} rate limit counters for user.`,
    });
  } catch (error) {
    console.error('Error resetting user rate limits:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/rate-limits/reset/all
 * @desc Reset all rate limit counters
 * @access Super-Admin only
 */
router.post('/reset/all', async (req, res) => {
  try {
    const clearedCount = await rateLimitService.resetAllCounters();

    res.json({
      success: true,
      message: `Reset ${clearedCount} rate limit counters.`,
    });
  } catch (error) {
    console.error('Error resetting all rate limits:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/rate-limits/check
 * @desc Check rate limit status for a user/endpoint combination (for testing)
 * @access Super-Admin only
 */
router.post('/check', async (req, res) => {
  try {
    const { user_id, role_id, endpoint } = req.body;

    if (!user_id || !endpoint) {
      return res.status(400).json({
        success: false,
        error: 'user_id and endpoint are required',
      });
    }

    const result = await rateLimitService.checkRateLimit(
      parseInt(user_id),
      role_id ? parseInt(role_id) : null,
      endpoint
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error checking rate limit:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
