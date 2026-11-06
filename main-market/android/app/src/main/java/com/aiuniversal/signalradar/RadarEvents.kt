package com.aiuniversal.signalradar
import org.json.JSONObject
object RadarEvents { @Volatile var listener:((JSONObject)->Unit)?=null; fun emit(d:JSONObject){listener?.invoke(d)} }