package com.otcvision.radar.capture

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores the ingest token encrypted with an Android Keystore AES-GCM key. */
object SecureServerConfig {
    data class Config(val baseUrl: String, val token: String)
    private const val PREFS = "otc_server_config"
    private const val KEY_ALIAS = "otc_vision_ingest_token_v1"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    fun save(context: Context, baseUrl: String, token: String) {
        require(baseUrl.startsWith("https://", ignoreCase = true)) { "Server URL must use HTTPS" }
        require(token.isNotBlank()) { "Server token is required" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("base_url", baseUrl.trim().trimEnd('/').removeSuffix("/v1/frame"))
            .putString("token_ciphertext", encoded)
            .apply()
    }

    fun load(context: Context): Config? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val baseUrl = prefs.getString("base_url", null) ?: return null
        val encoded = prefs.getString("token_ciphertext", null) ?: return null
        return try {
            val payload = Base64.decode(encoded, Base64.NO_WRAP)
            require(payload.size > 12)
            val iv = payload.copyOfRange(0, 12)
            val ciphertext = payload.copyOfRange(12, payload.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            Config(baseUrl, String(cipher.doFinal(ciphertext), Charsets.UTF_8))
        } catch (_: Exception) { null }
    }

    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
}
