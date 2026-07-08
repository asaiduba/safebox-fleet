const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { logAuditAction } = require('../utils/audit');

// GET /api/groups - Retrieve all groups owned by user
router.get('/', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);

    try {
        const groups = db.prepare('SELECT * FROM vehicle_groups WHERE owner_id = ? ORDER BY name ASC').all(userId);
        res.json(groups);
    } catch (err) {
        console.error('Failed to fetch groups:', err);
        res.status(500).json({ error: 'Failed to retrieve groups.' });
    }
});

// POST /api/groups - Create a new group
router.post('/', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const { name } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Group name is required.' });
    }

    try {
        const info = db.prepare('INSERT INTO vehicle_groups (owner_id, name, created_at) VALUES (?, ?, ?)')
                      .run(userId, name.trim(), Date.now());

        const groupId = info.lastInsertRowid;

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'create_group',
            groupId.toString(),
            { groupName: name.trim() },
            req
        );

        const io = req.app.get('io');
        if (io) {
            io.to(`user_${userId}`).emit('sync-data', { type: 'groups' });
        }

        res.json({ success: true, id: groupId, name: name.trim() });
    } catch (err) {
        console.error('Failed to create group:', err);
        res.status(500).json({ error: 'Failed to create group.' });
    }
});

// PUT /api/groups/:id - Rename a group
router.put('/:id', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const groupId = req.params.id;
    const { name } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Group name is required.' });
    }

    try {
        const group = db.prepare('SELECT owner_id, name FROM vehicle_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        if (group.owner_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to modify this group.' });
        }

        db.prepare('UPDATE vehicle_groups SET name = ? WHERE id = ?').run(name.trim(), groupId);

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'rename_group',
            groupId.toString(),
            { oldName: group.name, newName: name.trim() },
            req
        );

        const io = req.app.get('io');
        if (io) {
            io.to(`user_${userId}`).emit('sync-data', { type: 'groups' });
        }

        res.json({ success: true, message: 'Group renamed successfully.' });
    } catch (err) {
        console.error('Failed to rename group:', err);
        res.status(500).json({ error: 'Failed to rename group.' });
    }
});

// DELETE /api/groups/:id - Delete a group
router.delete('/:id', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const groupId = req.params.id;

    try {
        const group = db.prepare('SELECT owner_id, name FROM vehicle_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        if (group.owner_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to delete this group.' });
        }

        db.transaction(() => {
            // Unassign all vehicles belonging to this group
            db.prepare('UPDATE vehicles SET group_id = NULL WHERE group_id = ?').run(groupId);
            
            // Delete the group
            db.prepare('DELETE FROM vehicle_groups WHERE id = ?').run(groupId);
        })();

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'delete_group',
            groupId.toString(),
            { groupName: group.name },
            req
        );

        const io = req.app.get('io');
        if (io) {
            io.to(`user_${userId}`).emit('sync-data', { type: 'groups' });
        }

        res.json({ success: true, message: 'Group deleted successfully.' });
    } catch (err) {
        console.error('Failed to delete group:', err);
        res.status(500).json({ error: 'Failed to delete group.' });
    }
});

// POST /api/groups/:id/assign - Assign vehicles to a group
router.post('/:id/assign', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const groupId = req.params.id;
    const { vehicleIds } = req.body; // Array of vehicle IDs

    if (!Array.isArray(vehicleIds)) {
        return res.status(400).json({ error: 'vehicleIds parameter must be an array.' });
    }

    try {
        // Verify group ownership
        const group = db.prepare('SELECT owner_id, name FROM vehicle_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        if (group.owner_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to manage assignments for this group.' });
        }

        db.transaction(() => {
            // Step 1: Set group_id = NULL for all vehicles currently in this group
            db.prepare('UPDATE vehicles SET group_id = NULL WHERE group_id = ? AND owner_id = ?').run(groupId, userId);

            // Step 2: Assign new vehicles to this group (verifying they belong to the user)
            if (vehicleIds.length > 0) {
                const assignStmt = db.prepare('UPDATE vehicles SET group_id = ? WHERE id = ? AND owner_id = ?');
                for (const vid of vehicleIds) {
                    assignStmt.run(groupId, vid, userId);
                }
            }
        })();

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'assign_group_vehicles',
            groupId.toString(),
            { groupName: group.name, assignedVehiclesCount: vehicleIds.length, vehicleIds },
            req
        );

        const io = req.app.get('io');
        if (io) {
            io.to(`user_${userId}`).emit('sync-data', { type: 'groups' });
        }

        res.json({ success: true, message: 'Vehicles assigned successfully.' });
    } catch (err) {
        console.error('Failed to assign vehicles to group:', err);
        res.status(500).json({ error: 'Failed to assign vehicles to group.' });
    }
});

module.exports = router;
