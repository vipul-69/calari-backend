const fetch = require("node-fetch");

async function verifyPayment() {
  const response = await fetch(`https://live.dodopayments.com/payments/pay_3Gt18b8BDtG8VUgS0fulw`, {
    method: "GET",
    headers: {
      Authorization: `Bearer SfU-Bh7r7KCeB898.ccvQedY8lOLfyv1WiCBVVLwSczf9flR5IxxQwl6-mKE-OK_E`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Error verifying payment: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(data)
  return data.status === "succeeded";
}


verifyPayment()
