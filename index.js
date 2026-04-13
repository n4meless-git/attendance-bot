require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. 설정
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
});

// 2. 출근 로직
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content !== "출근") return;

    const userId = message.author.id;
    const username = message.author.username;
    
    // [중요] 한국 시간(KST, UTC+9) 기준으로 오늘 날짜 가져오기
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];

    try {
        // 기존 출근 기록 확인
        const { data: user } = await supabase
            .from('attendance')
            .lastSelect('*')
            .eq('user_id', userId)
            .single();

        if (user && user.last_attendance_date === today) {
            return message.reply("이미 오늘 출근하셨어요! ✨");
        }

        let newStreak = 1;
        if (user) {
            const lastDate = new Date(user.last_attendance_date);
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_attendance_date === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        // 데이터 업데이트 또는 삽입
        const { error } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_attendance_date: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (error) throw error;

        message.reply(`✅ 출근 완료! 현재 **${newStreak}일** 연속 출근 중! 🔥`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ 출근 처리 중 오류가 발생했습니다.");
    }
});

client.login(process.env.DISCORD_TOKEN);

        let newStreak = 1;
        if (user) {
            const lastDate = new Date(user.last_checkin);
            const diffDays = Math.ceil(Math.abs(new Date(today) - lastDate) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) newStreak = (user.streak || 0) + 1;
        }

        await supabase.from('attendance').upsert({ 
            user_id: userId, username, last_checkin: today, streak: newStreak 
        });

        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥`);
    } catch (err) {
        console.error(err);
        message.reply("DB 에러 발생!");
    }
});

client.login(process.env.DISCORD_TOKEN);
