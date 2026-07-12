// Einzige Activity — alles Weitere ist Compose-Navigation.
package app.luhambo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.luhambo.ui.LuhamboNavigation
import app.luhambo.ui.LuhamboTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LuhamboTheme {
                LuhamboNavigation()
            }
        }
    }
}
