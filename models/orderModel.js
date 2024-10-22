const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  items: [{ product_name: String, quantity: Number }],
  total_price: { type: Number, required: true },
  address: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
