const { Server } = require('socket.io');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.on('connection', (socket) => {

    // Join personal room
    socket.on('join', (userId) => {
      if (userId) socket.join(`user_${userId}`);
    });

    // Join admin room
    socket.on('joinAdmin', () => {
      socket.join('admin_room');
    });

    // Join conversation room
    socket.on('joinConversation', (conversationId) => {
      if (conversationId) socket.join(`conv_${conversationId}`);
    });

    // ===== SEND MESSAGE =====
    socket.on('sendMessage', async (data) => {
      try {
        const { conversationId, senderId, receiverId, content } = data;

        if (!conversationId || !senderId || !content?.trim()) return;

        // Save to DB
        const message = await Message.create({
          conversation: conversationId,
          sender: senderId,
          content: content.trim()
        });

        // Update conversation lastMessage
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: message._id,
          updatedAt: new Date()
        });

        // Populate sender info (no raw avatar Buffer over websocket)
        const populatedMsg = await Message.findById(message._id)
          .populate('sender', 'name googleAvatar role')
          .lean();

        // Emit to ALL in conversation room (both sender + receiver)
        io.to(`conv_${conversationId}`).emit('newMessage', populatedMsg);

        // Update conversation list for both users
        io.to(`conv_${conversationId}`).emit('conversationUpdated', {
          conversationId,
          lastMessage: content.trim(),
          updatedAt: new Date()
        });

        // Send notification to receiver only
        if (receiverId) {
          const notification = await Notification.create({
            recipient: receiverId,
            sender: senderId,
            type: 'message',
            message: 'You have a new message',
            link: `/messages/${conversationId}`
          });
          const populatedNotif = await notification.populate('sender', 'name googleAvatar');
          io.to(`user_${receiverId}`).emit('newNotification', populatedNotif);
        }

      } catch (err) {
        console.error('Socket sendMessage error:', err);
        socket.emit('messageError', { error: 'Failed to send message' });
      }
    });

    // Typing indicators
    socket.on('typing', (data) => {
      socket.to(`conv_${data.conversationId}`).emit('userTyping', data);
    });

    socket.on('stopTyping', (data) => {
      socket.to(`conv_${data.conversationId}`).emit('userStopTyping', data);
    });

    // Graph updates
    socket.on('requestGraphUpdate', async (data) => {
      try {
        const graphData = await require('../utils/graphData').getGraphData(data.role, data.userId);
        socket.emit('graphUpdate', graphData);
      } catch (err) {
        console.error('Graph update error:', err);
      }
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };