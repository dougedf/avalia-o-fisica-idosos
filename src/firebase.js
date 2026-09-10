import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBPw39dVpxFEuBGDPhmONotuxshUzkmF_A",
  authDomain: "aplicativo-idosos.firebaseapp.com",
  projectId: "aplicativo-idosos",
  storageBucket: "aplicativo-idosos.firebasestorage.app",
  messagingSenderId: "376488166884",
  appId: "1:376488166884:web:14cc7f300d604f81e433f1",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
