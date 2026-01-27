const express = require('express');
const router = express.Router();
const userManagementService = require('../../services/userManagementService');

/**
 * @route GET /api/admin/roles
 * @desc Get all roles
 * @access Admin
 */
router.get('/', async (req, res) => {
  try {
    const roles = await userManagementService.getAllRoles();

    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/roles/:id
 * @desc Get role by ID with modules
 * @access Admin
 */
router.get('/:id', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await userManagementService.getRoleById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'Role not found',
      });
    }

    res.json({
      success: true,
      data: role,
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/roles
 * @desc Create new role
 * @access Admin
 */
router.post('/', async (req, res) => {
  try {
    const { name, slug, description } = req.body;

    // Validation
    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        error: 'Name and slug are required',
      });
    }

    const roleData = { name, slug, description };
    const role = await userManagementService.createRole(roleData);

    res.status(201).json({
      success: true,
      data: role,
      message: 'Role created successfully',
    });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/roles/:id
 * @desc Update role
 * @access Admin
 */
router.put('/:id', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const { name, description } = req.body;

    const roleData = { name, description };
    const role = await userManagementService.updateRole(roleId, roleData);

    res.json({
      success: true,
      data: role,
      message: 'Role updated successfully',
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/admin/roles/:id
 * @desc Delete role
 * @access Admin
 */
router.delete('/:id', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const deleted = await userManagementService.deleteRole(roleId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Role not found',
      });
    }

    res.json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/roles/:id/modules
 * @desc Assign module to role with permissions
 * @access Admin
 */
router.post('/:id/modules', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const { module_id, permissions } = req.body;

    // Validation
    if (!module_id) {
      return res.status(400).json({
        success: false,
        error: 'Module ID is required',
      });
    }

    // Default permissions if not provided
    const defaultPermissions = {
      read: false,
      write: false,
      delete: false,
      admin: false,
    };

    const finalPermissions = { ...defaultPermissions, ...permissions };

    const result = await userManagementService.assignModuleToRole(
      roleId,
      parseInt(module_id),
      finalPermissions
    );

    res.json({
      success: true,
      data: result,
      message: 'Module assigned to role successfully',
    });
  } catch (error) {
    console.error('Error assigning module to role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/admin/roles/:id/modules/:moduleId
 * @desc Remove module from role
 * @access Admin
 */
router.delete('/:id/modules/:moduleId', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const moduleId = parseInt(req.params.moduleId);

    const deleted = await userManagementService.removeModuleFromRole(roleId, moduleId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Module assignment not found',
      });
    }

    res.json({
      success: true,
      message: 'Module removed from role successfully',
    });
  } catch (error) {
    console.error('Error removing module from role:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/roles/:id/modules/:moduleId
 * @desc Update module permissions for role
 * @access Admin
 */
router.put('/:id/modules/:moduleId', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const moduleId = parseInt(req.params.moduleId);
    const { permissions } = req.body;

    if (!permissions) {
      return res.status(400).json({
        success: false,
        error: 'Permissions are required',
      });
    }

    const result = await userManagementService.assignModuleToRole(
      roleId,
      moduleId,
      permissions
    );

    res.json({
      success: true,
      data: result,
      message: 'Module permissions updated successfully',
    });
  } catch (error) {
    console.error('Error updating module permissions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
