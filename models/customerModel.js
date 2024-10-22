const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  whatsappNumber: { type: String, required: true, unique: true },
  currentOrder: { type: Object }, // Temporary order details
  address: { type: String } // Delivery address
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);
