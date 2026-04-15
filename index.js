require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. 설정 (Supabase 연결)
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
    // 봇이 쓴 메시지거나 "출근"이 아니면 무시
    if (message.author.bot || message.content !== "출근") return;

    const userId = message.author.id;
    const username = message.author.username;
    
    // [핵심] 한국 시간(KST, UTC+9) 기준으로 오늘 날짜 가져오기
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];

    try {
        // 기존 유저 데이터 불러오기
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .single();

        // 1. 이미 오늘 출근했는지 확인
        if (user && user.last_attendance_date === today) {
            return message.reply("이미 오늘 출근하셨어요! ✨");
        }

        // 2. 연속 출근(Streak) 계산
        let newStreak = 1;
        if (user && user.last_attendance_date) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            // 어제 날짜와 마지막 출근 날짜가 같다면 연속 기록 +1
            if (user.last_attendance_date === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        // 3. 데이터 업데이트 (upsert)
        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_attendance_date: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;

        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥`);

    } catch (err) {
        console.error("에러 발생:", err);
        message.reply("⚠️ DB 처리 중 오류가 발생했습니다!");
    }
});

client.login(process.env.DISCORD_TOKEN);
